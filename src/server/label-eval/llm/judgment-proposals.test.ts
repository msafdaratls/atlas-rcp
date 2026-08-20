import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { LabelKbRule } from "@prisma/client";
import { chunk, fieldsToText, ruleGuidanceText, getJudgmentProposals } from "./judgment-proposals";

function rule(overrides: Partial<LabelKbRule>): LabelKbRule {
  return {
    id: "rule_1",
    kbVersionId: "kb_1",
    domain: "SFDA_SUPPLEMENTS",
    ruleType: "CHECKLIST_ITEM",
    code: "GSO_9_01",
    section: "GSO_9",
    titleEn: "Product name in Arabic and English",
    titleAr: "اسم المنتج بالعربية والإنجليزية",
    priority: "Critical",
    evaluatorKey: "wording_judgment",
    payload: {},
    autoVerifiable: true,
    ...overrides,
  };
}

describe("getJudgmentProposals — fail-closed guards (design doc §1 Principle 2)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns no proposals when ANTHROPIC_API_KEY is unset — no network attempted", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await getJudgmentProposals("SFDA_SUPPLEMENTS", {}, [rule({})]);
    assert.deepEqual(result, {});
  });

  it("returns no proposals when there are no judgment rules, even with a key set — no network attempted", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake";
    const result = await getJudgmentProposals("SFDA_SUPPLEMENTS", {}, []);
    assert.deepEqual(result, {});
  });
});

describe("chunk", () => {
  it("splits into groups of the given size, last group short", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  it("returns a single group when input is smaller than the batch size", () => {
    assert.deepEqual(chunk([1, 2], 40), [[1, 2]]);
  });

  it("returns an empty array for empty input", () => {
    assert.deepEqual(chunk([], 40), []);
  });
});

describe("fieldsToText", () => {
  it("includes only fields with non-blank EN or AR text", () => {
    const text = fieldsToText({
      product_name: { en: "Vitamin C", ar: "فيتامين سي" },
      warnings: { en: "  ", ar: "" }, // whitespace-only — must be excluded
      batch_number: undefined,
      brand: { en: "Acme" },
    });
    assert.match(text, /product_name: EN="Vitamin C" AR="فيتامين سي"/);
    assert.match(text, /brand: EN="Acme" AR=""/);
    assert.doesNotMatch(text, /warnings/);
    assert.doesNotMatch(text, /batch_number/);
  });

  it("returns an empty string when no fields have confirmed text", () => {
    assert.equal(fieldsToText({}), "");
  });
});

describe("ruleGuidanceText", () => {
  it("includes code, titles, section, and available payload guidance", () => {
    const text = ruleGuidanceText(
      rule({
        code: "GSO_9_07",
        titleEn: "Warnings present",
        titleAr: "التحذيرات موجودة",
        section: "GSO_9",
        payload: { compliantWhen: "Warnings text is printed on the label.", commonNonConformities: "Warnings missing entirely." },
      }),
    );
    assert.match(text, /\[GSO_9_07\]/);
    assert.match(text, /Warnings present \/ التحذيرات موجودة \(section GSO_9\)/);
    assert.match(text, /Warnings text is printed on the label\./);
    assert.match(text, /Warnings missing entirely\./);
  });

  it("omits the guidance line entirely when payload has no known guidance keys", () => {
    const text = ruleGuidanceText(rule({ code: "X_1", titleEn: "Something", section: null, payload: {} }));
    assert.doesNotMatch(text, /Guidance:/);
    assert.doesNotMatch(text, /\(section/);
  });
});
