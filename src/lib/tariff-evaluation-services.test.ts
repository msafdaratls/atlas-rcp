import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheckSet } from "@/lib/assessment";
import {
  buildSections,
  hashSections,
  parseSectionVerdicts,
  parseSnapshot,
  scoreSnapshot,
  SECTION_DOCUMENTS,
  SECTION_GENERAL,
  SECTION_LABELING,
  snapshotItemCount,
  standardSectionKey,
  type TariffEvaluationSnapshot,
} from "@/lib/tariff-evaluation-services";

function set(code: string, itemCodes: string[]): CheckSet {
  return {
    code,
    titleEn: code,
    titleAr: code,
    items: itemCodes.map((c) => ({ code: c, titleEn: c, titleAr: c })),
  };
}

function standard(id: string, itemCodes: string[]) {
  return { id, code: id, titleEn: id, titleAr: id, checklist: [set(id, itemCodes)] };
}

function snapshot(
  sections: ReturnType<typeof buildSections>,
): TariffEvaluationSnapshot {
  return {
    version: 1,
    regulation: { id: "reg", code: "REG", titleEn: "Reg", titleAr: "لائحة" },
    tariffItem: {
      id: "ti",
      hsCode: "760719900001",
      productTitleEn: "Product",
      productTitleAr: "منتج",
      requiredCertificates: [],
      conformityModule: null,
    },
    generalStandards: [],
    specificStandards: [],
    sections,
    hash: hashSections(sections),
  };
}

const SECTIONS = buildSections({
  regulation: {
    generalChecklist: [set("GENERAL", ["A-01", "A-02"])],
    labelingChecklist: [set("LABEL", ["L-01"])],
    documentsChecklist: [set("DOCUMENTS", ["D-01"])],
  },
  generalStandards: [standard("gen-std", ["G-01"])],
  specificStandards: [standard("spec-std", ["S-01"])],
});

describe("buildSections", () => {
  it("orders sections the way the evaluator works through them", () => {
    assert.deepEqual(SECTIONS.map((s) => s.key), [
      SECTION_GENERAL,
      standardSectionKey("gen-std"),
      SECTION_LABELING,
      standardSectionKey("spec-std"),
      SECTION_DOCUMENTS,
    ]);
  });

  it("gives every standard its own section key", () => {
    const keys = new Set(SECTIONS.map((s) => s.key));
    assert.equal(keys.size, SECTIONS.length);
  });

  it("counts every answerable item across sections", () => {
    assert.equal(snapshotItemCount(snapshot(SECTIONS)), 6);
  });
});

describe("scoreSnapshot", () => {
  const full = snapshot(SECTIONS);

  function allVerdicts(verdict: "COMPLIANT" | "NON_COMPLIANT" | "NA") {
    return Object.fromEntries(
      SECTIONS.map((section) => [
        section.key,
        {
          verdicts: Object.fromEntries(
            section.checkSets.flatMap((s) => s.items.map((i) => [i.code, verdict])),
          ),
        },
      ]),
    );
  }

  it("is incomplete until every section is answered", () => {
    const summary = scoreSnapshot(full, { [SECTION_GENERAL]: { verdicts: { "A-01": "COMPLIANT" } } });
    assert.equal(summary.complete, false);
    assert.equal(summary.recommendation, "INCOMPLETE");
  });

  it("accepts when everything is compliant", () => {
    const summary = scoreSnapshot(full, allVerdicts("COMPLIANT"));
    assert.equal(summary.complete, true);
    assert.equal(summary.recommendation, "ACCEPTED");
  });

  it("REJECTS on a single non-compliant item, matching the source tools", () => {
    // 5 of 6 compliant is 83% — inside the app's 80% remarks band, which the
    // source conformity tools do not have: any non-conformity fails outright.
    const verdicts = allVerdicts("COMPLIANT");
    verdicts[SECTION_DOCUMENTS] = { verdicts: { "D-01": "NON_COMPLIANT" } };
    const summary = scoreSnapshot(full, verdicts);
    assert.equal(summary.complete, true);
    assert.equal(summary.nonCompliant, 1);
    assert.equal(summary.recommendation, "REJECTED");
  });

  it("does not let N/A answers drag the decision down", () => {
    const summary = scoreSnapshot(full, allVerdicts("NA"));
    assert.equal(summary.complete, true);
    assert.equal(summary.recommendation, "ACCEPTED");
  });

  it("scores each standard against its own map, so a shared item code is not double-counted", () => {
    // Both standards use item code "X-01". With one shared verdict map, a
    // single answer would satisfy both and be counted twice.
    const clashing = buildSections({
      regulation: { generalChecklist: [], labelingChecklist: [], documentsChecklist: [] },
      generalStandards: [standard("std-a", ["X-01"])],
      specificStandards: [standard("std-b", ["X-01"])],
    });
    const snap = snapshot(clashing);

    const onlyFirstAnswered = scoreSnapshot(snap, {
      [standardSectionKey("std-a")]: { verdicts: { "X-01": "COMPLIANT" } },
    });
    assert.equal(onlyFirstAnswered.total, 2);
    assert.equal(onlyFirstAnswered.assessed, 1);
    assert.equal(onlyFirstAnswered.complete, false);

    const bothAnswered = scoreSnapshot(snap, {
      [standardSectionKey("std-a")]: { verdicts: { "X-01": "COMPLIANT" } },
      [standardSectionKey("std-b")]: { verdicts: { "X-01": "COMPLIANT" } },
    });
    assert.equal(bothAnswered.assessed, 2);
    assert.equal(bothAnswered.complete, true);
  });

  it("treats an entirely empty catalog as complete, leaving the block to the caller", () => {
    const empty = snapshot(
      buildSections({
        regulation: { generalChecklist: [], labelingChecklist: [], documentsChecklist: [] },
        generalStandards: [],
        specificStandards: [],
      }),
    );
    assert.equal(snapshotItemCount(empty), 0);
    assert.equal(scoreSnapshot(empty, {}).complete, true);
  });
});

describe("hashSections", () => {
  it("is stable for identical content", () => {
    assert.equal(hashSections(SECTIONS), hashSections(SECTIONS));
  });

  it("changes when an item's title changes, so a stale panel is detected", () => {
    const edited = buildSections({
      regulation: {
        generalChecklist: [
          { code: "GENERAL", titleEn: "GENERAL", titleAr: "GENERAL", items: [
            { code: "A-01", titleEn: "changed", titleAr: "A-01" },
            { code: "A-02", titleEn: "A-02", titleAr: "A-02" },
          ] },
        ],
        labelingChecklist: [set("LABEL", ["L-01"])],
        documentsChecklist: [set("DOCUMENTS", ["D-01"])],
      },
      generalStandards: [standard("gen-std", ["G-01"])],
      specificStandards: [standard("spec-std", ["S-01"])],
    });
    assert.notEqual(hashSections(SECTIONS), hashSections(edited));
  });

  it("changes when an item is removed", () => {
    const fewer = buildSections({
      regulation: {
        generalChecklist: [set("GENERAL", ["A-01"])],
        labelingChecklist: [set("LABEL", ["L-01"])],
        documentsChecklist: [set("DOCUMENTS", ["D-01"])],
      },
      generalStandards: [standard("gen-std", ["G-01"])],
      specificStandards: [standard("spec-std", ["S-01"])],
    });
    assert.notEqual(hashSections(SECTIONS), hashSections(fewer));
  });
});

describe("defensive parsing of stored JSON", () => {
  it("rejects a snapshot of an unknown version rather than rendering it", () => {
    assert.equal(parseSnapshot({ version: 2, sections: [], regulation: {}, tariffItem: {} }), null);
    assert.equal(parseSnapshot(null), null);
    assert.equal(parseSnapshot("nonsense"), null);
  });

  it("drops verdict values that are not real verdicts", () => {
    const parsed = parseSectionVerdicts({
      general: { verdicts: { "A-01": "COMPLIANT", "A-02": "BOGUS" } },
      broken: { notVerdicts: {} },
    });
    assert.deepEqual(parsed.general.verdicts, { "A-01": "COMPLIANT" });
    assert.equal(parsed.broken, undefined);
  });
});
