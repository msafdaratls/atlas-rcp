import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  combineAssessments,
  computeAssessment,
  parseAssessment,
  parseCheckSets,
  recommendDecision,
  type CheckSet,
} from "@/lib/assessment";

function set(code: string, itemCodes: string[]): CheckSet {
  return {
    code,
    titleEn: code,
    titleAr: code,
    items: itemCodes.map((c) => ({ code: c, titleEn: c, titleAr: c })),
  };
}

const CHECK_SETS: CheckSet[] = [
  set("A", ["A1", "A2", "A3"]),
  set("B", ["B1", "B2"]),
];

describe("recommendDecision", () => {
  it("is INCOMPLETE until every item is assessed", () => {
    assert.equal(recommendDecision(1, false), "INCOMPLETE");
    assert.equal(recommendDecision(0.5, false), "INCOMPLETE");
  });

  it("accepts at 100%", () => {
    assert.equal(recommendDecision(1, true), "ACCEPTED");
  });

  it("accepts with remarks between 80% and 100%", () => {
    assert.equal(recommendDecision(0.8, true), "ACCEPTED_WITH_REMARKS");
    assert.equal(recommendDecision(0.95, true), "ACCEPTED_WITH_REMARKS");
  });

  it("rejects below 80%", () => {
    assert.equal(recommendDecision(0.79, true), "REJECTED");
    assert.equal(recommendDecision(0, true), "REJECTED");
  });

  it("treats an all-N/A section (null rate) as accepted when complete", () => {
    assert.equal(recommendDecision(null, true), "ACCEPTED");
  });
});

describe("computeAssessment", () => {
  it("reports pending items and stays incomplete", () => {
    const s = computeAssessment(CHECK_SETS, { verdicts: { A1: "COMPLIANT" } });
    assert.equal(s.total, 5);
    assert.equal(s.assessed, 1);
    assert.equal(s.pending, 4);
    assert.equal(s.complete, false);
    assert.equal(s.recommendation, "INCOMPLETE");
  });

  it("excludes N/A from the rate denominator", () => {
    const s = computeAssessment(CHECK_SETS, {
      verdicts: {
        A1: "COMPLIANT",
        A2: "COMPLIANT",
        A3: "NA",
        B1: "COMPLIANT",
        B2: "NA",
      },
    });
    // 3 compliant, 0 non-compliant, 2 N/A -> rate 3/3 = 1
    assert.equal(s.overallRate, 1);
    assert.equal(s.complete, true);
    assert.equal(s.recommendation, "ACCEPTED");
    const a = s.sections.find((x) => x.code === "A")!;
    assert.equal(a.na, 1);
    assert.equal(a.rate, 1); // A1,A2 compliant; A3 N/A excluded
  });

  it("computes an 80% boundary as accepted-with-remarks", () => {
    // 4 compliant, 1 non-compliant across 5 items -> 0.8
    const s = computeAssessment(CHECK_SETS, {
      verdicts: {
        A1: "COMPLIANT",
        A2: "COMPLIANT",
        A3: "COMPLIANT",
        B1: "COMPLIANT",
        B2: "NON_COMPLIANT",
      },
    });
    assert.equal(s.overallRate, 0.8);
    assert.equal(s.recommendation, "ACCEPTED_WITH_REMARKS");
  });

  it("rejects below the threshold", () => {
    const s = computeAssessment(CHECK_SETS, {
      verdicts: {
        A1: "NON_COMPLIANT",
        A2: "NON_COMPLIANT",
        A3: "COMPLIANT",
        B1: "COMPLIANT",
        B2: "COMPLIANT",
      },
    });
    // 3/5 = 0.6
    assert.equal(s.overallRate, 0.6);
    assert.equal(s.recommendation, "REJECTED");
  });

  it("handles an empty checklist without dividing by zero", () => {
    const s = computeAssessment([], { verdicts: {} });
    assert.equal(s.total, 0);
    assert.equal(s.complete, false);
    assert.equal(s.overallRate, null);
    assert.equal(s.recommendation, "INCOMPLETE");
  });
});

describe("parseAssessment", () => {
  it("keeps only valid verdicts and non-empty notes", () => {
    const s = parseAssessment({
      verdicts: { A1: "COMPLIANT", A2: "BOGUS", A3: 3 },
      notes: { A1: "  ok  ", A2: "   ", A3: 5 },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(s.verdicts, { A1: "COMPLIANT" });
    assert.deepEqual(s.notes, { A1: "  ok  " });
    assert.equal(s.updatedAt, "2026-01-01T00:00:00.000Z");
  });

  it("tolerates garbage input", () => {
    assert.deepEqual(parseAssessment(null).verdicts, {});
    assert.deepEqual(parseAssessment("x").verdicts, {});
    assert.deepEqual(parseAssessment(42).verdicts, {});
  });
});

describe("parseCheckSets", () => {
  it("normalises well-formed sets and drops malformed ones", () => {
    const parsed = parseCheckSets([
      { code: "A", titleEn: "Sec A", titleAr: "أ", items: [{ code: "A1", titleEn: "x", titleAr: "س" }] },
      { nope: true },
      "garbage",
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].items.length, 1);
    assert.equal(parsed[0].itemCount, 1);
  });

  it("returns [] for non-arrays", () => {
    assert.deepEqual(parseCheckSets(null), []);
    assert.deepEqual(parseCheckSets({}), []);
  });
});

describe("combineAssessments — tariff evaluation's three independent sections", () => {
  const general = set("GENERAL", ["G1", "G2"]);
  const labeling = set("LABEL", ["L1"]);

  it("sums totals and answers across sections", () => {
    const summary = combineAssessments([
      computeAssessment([general], { verdicts: { G1: "COMPLIANT", G2: "COMPLIANT" } }),
      computeAssessment([labeling], { verdicts: { L1: "COMPLIANT" } }),
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.assessed, 3);
    assert.equal(summary.complete, true);
    assert.equal(summary.recommendation, "ACCEPTED");
  });

  it("does NOT let one section's answer satisfy the same code in another section", () => {
    // The same item code legitimately appears in two sections. Scoring a
    // merged verdict map would count this as 2-of-2 answered; scoring the
    // sections independently correctly reports it as 1-of-2.
    const shared = set("SPECIFIC", ["G1"]);
    const summary = combineAssessments([
      computeAssessment([general], { verdicts: { G1: "COMPLIANT", G2: "COMPLIANT" } }),
      computeAssessment([shared], { verdicts: {} }),
    ]);
    assert.equal(summary.total, 3);
    assert.equal(summary.assessed, 2);
    assert.equal(summary.complete, false);
    assert.equal(summary.recommendation, "INCOMPLETE");
  });

  it("treats a zero-item evaluation as complete, not permanently blocked", () => {
    // Every template still empty: there is nothing to answer, so the
    // evaluation must remain completable rather than deadlocking the request.
    const summary = combineAssessments([
      computeAssessment([], { verdicts: {} }),
      computeAssessment([], { verdicts: {} }),
    ]);
    assert.equal(summary.total, 0);
    assert.equal(summary.complete, true);
    assert.equal(summary.recommendation, "ACCEPTED");
  });

  it("is incomplete while any section has an unanswered item", () => {
    const summary = combineAssessments([
      computeAssessment([general], { verdicts: { G1: "COMPLIANT" } }),
      computeAssessment([labeling], { verdicts: { L1: "COMPLIANT" } }),
    ]);
    assert.equal(summary.complete, false);
    assert.equal(summary.recommendation, "INCOMPLETE");
  });

  it("carries a non-compliant item in any section into the overall decision", () => {
    const summary = combineAssessments([
      computeAssessment([general], { verdicts: { G1: "COMPLIANT", G2: "COMPLIANT" } }),
      computeAssessment([labeling], { verdicts: { L1: "NON_COMPLIANT" } }),
    ]);
    assert.equal(summary.complete, true);
    // 2 of 3 compliant = 66% — below the 80% remarks threshold.
    assert.equal(summary.recommendation, "REJECTED");
  });

  it("N/A items never drag the decision down", () => {
    const summary = combineAssessments([
      computeAssessment([general], { verdicts: { G1: "COMPLIANT", G2: "NA" } }),
      computeAssessment([labeling], { verdicts: { L1: "NA" } }),
    ]);
    assert.equal(summary.complete, true);
    assert.equal(summary.recommendation, "ACCEPTED");
  });
});
