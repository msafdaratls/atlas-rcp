import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LabelKbRule } from "@prisma/client";
import { formatRuleForClient, hasRuleMatch, matchRules } from "./kb-search";

function rule(overrides: Partial<LabelKbRule>): LabelKbRule {
  return {
    id: "rule_1",
    kbVersionId: "kb_1",
    domain: "SFDA_SUPPLEMENTS",
    ruleType: "CHECKLIST_ITEM",
    code: "GSO_9_01",
    section: "GSO_9",
    titleEn: "Net weight declaration",
    titleAr: "بيان الوزن الصافي",
    priority: null,
    evaluatorKey: "label_presence",
    payload: { compliantWhen: "Net weight is declared in grams alongside the product name." },
    autoVerifiable: true,
    ...overrides,
  };
}

describe("matchRules", () => {
  it("ranks a rule whose title matches the query above one that doesn't", () => {
    const netWeight = rule({ id: "r1", titleEn: "Net weight declaration", payload: {} });
    const allergen = rule({
      id: "r2",
      titleEn: "Allergen warning statement",
      code: "GSO_9_02",
      payload: {},
    });
    const result = matchRules([allergen, netWeight], "net weight");
    assert.equal(result[0].id, "r1");
  });

  it("matches on payload text, not just title", () => {
    const hit = rule({
      id: "r1",
      titleEn: "General labeling",
      payload: { decisionRule: "Sodium content must not exceed 500mg per serving." },
    });
    const miss = rule({ id: "r2", titleEn: "Unrelated item", code: "GSO_9_03", payload: {} });
    const result = matchRules([miss, hit], "sodium");
    assert.equal(result[0].id, "r1");
  });

  it("falls back to returning all rules (bounded by limit) when no word matches", () => {
    const rules = [rule({ id: "r1" }), rule({ id: "r2", code: "GSO_9_02" })];
    const result = matchRules(rules, "xyzzy-nonexistent-term", 5);
    assert.equal(result.length, 2);
  });

  it("respects the limit", () => {
    const rules = Array.from({ length: 10 }, (_, i) => rule({ id: `r${i}`, code: `GSO_9_${i}` }));
    const result = matchRules(rules, "net weight", 3);
    assert.equal(result.length, 3);
  });
});

describe("hasRuleMatch", () => {
  it("is true when a rule's title genuinely overlaps the query", () => {
    const netWeight = rule({ id: "r1", titleEn: "Net weight declaration", payload: {} });
    assert.equal(hasRuleMatch([netWeight], "net weight"), true);
  });

  it("is false when nothing overlaps, unlike matchRules' return-everything fallback", () => {
    const netWeight = rule({ id: "r1", titleEn: "Net weight declaration", payload: {} });
    assert.equal(hasRuleMatch([netWeight], "xyzzy-nonexistent-term"), false);
    // matchRules would still return this rule via its fallback — the two must disagree here.
    assert.equal(matchRules([netWeight], "xyzzy-nonexistent-term").length, 1);
  });
});

describe("formatRuleForClient", () => {
  it("includes code, section, both titles, and allowlisted payload text", () => {
    const text = formatRuleForClient(
      rule({ payload: { compliantWhen: "Must appear in grams." } }),
    );
    assert.match(text, /GSO_9_01/);
    assert.match(text, /GSO_9/);
    assert.match(text, /Net weight declaration/);
    assert.match(text, /بيان الوزن الصافي/);
    assert.match(text, /Must appear in grams\./);
  });

  it("never leaks internal-only payload keys like fieldKey or matchMode", () => {
    const text = formatRuleForClient(
      rule({ payload: { fieldKey: "net_weight", matchMode: "exact", triggerKeywords: "secret-heuristic" } }),
    );
    assert.doesNotMatch(text, /net_weight/);
    assert.doesNotMatch(text, /exact/);
    assert.doesNotMatch(text, /secret-heuristic/);
  });
});
