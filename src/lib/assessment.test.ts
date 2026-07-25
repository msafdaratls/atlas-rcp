import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
