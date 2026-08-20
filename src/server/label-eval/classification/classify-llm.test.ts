import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LabelKbCategory } from "@prisma/client";
import { classifyWithLlm } from "./classify-llm";

function category(overrides: Partial<LabelKbCategory>): LabelKbCategory {
  return {
    id: "cat_1",
    kbVersionId: "kb_1",
    domain: "COSMETICS",
    code: "SKIN_CARE",
    nameEn: "Skin Care",
    nameAr: "العناية بالبشرة",
    icon: null,
    properties: [],
    sortOrder: 0,
    ...overrides,
  };
}

describe("classifyWithLlm — fail-closed guards (design doc §1 Principle 4)", () => {
  // Both cases below return before ever calling the Claude API, so these run
  // safely with no network access and no ANTHROPIC_API_KEY configured —
  // proving the "no confident match" refusal never depends on reaching the
  // model at all for a genuinely unclassifiable input.

  it("returns no match when the active dataset has no categories", async () => {
    const result = await classifyWithLlm({ productNameEn: "Anything" }, []);
    assert.equal(result.categoryCode, null);
    assert.match(result.rationale, /No categories defined/);
  });

  it("returns no match when there is no confirmed text to classify from", async () => {
    const categories = [category({})];
    const result = await classifyWithLlm({}, categories);
    assert.equal(result.categoryCode, null);
    assert.match(result.rationale, /No confirmed text/);
  });

  it("treats whitespace-only confirmed fields as no confirmed text", async () => {
    const categories = [category({})];
    const result = await classifyWithLlm({ productNameEn: "   ", fullLabelTextEn: "\n\t" }, categories);
    assert.equal(result.categoryCode, null);
    assert.match(result.rationale, /No confirmed text/);
  });
});
