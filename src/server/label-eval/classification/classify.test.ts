import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LabelKbCategory } from "@prisma/client";
import { classify } from "./classify";

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

describe("classify (cosmetics classification)", () => {
  it("matches a cosmetic product with sufficient confidence", () => {
    const categories = [
      category({ code: "SKIN_CARE", nameEn: "Skin Care Moisturizer Cream", nameAr: "كريم مرطب للبشرة" }),
      category({ code: "HAIR_CARE", nameEn: "Hair Care Shampoo", nameAr: "شامبو للشعر" }),
    ];
    const result = classify(
      { productNameEn: "Day Cream", productFunctionEn: "Face moisturizer cream for skin care" },
      categories,
    );
    assert.equal(result.categoryCode, "SKIN_CARE");
    assert.ok(result.confidence >= 0.15);
  });

  it("does NOT force-classify a non-cosmetic (design doc §0.1 — the live-tool bug this fixes)", () => {
    const categories = [
      category({ code: "SKIN_CARE", nameEn: "Skin Care Moisturizer Cream", nameAr: "كريم مرطب للبشرة" }),
      category({ code: "ORAL_CARE", nameEn: "Oral Care Toothpaste", nameAr: "معجون أسنان للعناية بالفم" }),
    ];
    // The real BEYAN HERBS PROPOLIS supplement fixture — a food supplement,
    // not a cosmetic, that the live tool wrongly force-classified as Oral Care.
    const result = classify(
      {
        productNameEn: "PROPOLIS",
        productFunctionEn: "Food Supplement",
        ingredientsList: "Glycerin, Beeswax, Olive Oil, Bovine Gelatin, iron oxide",
        fullLabelTextEn: "Dietary supplements should not be used as a substitute for a balanced diet",
      },
      categories,
    );
    assert.equal(result.categoryCode, null);
  });

  it("returns no match when the active dataset has no categories", () => {
    const result = classify({ productNameEn: "Anything" }, []);
    assert.equal(result.categoryCode, null);
    assert.match(result.rationale, /No categories defined/);
  });

  it("returns no match when there is no confirmed text to classify from", () => {
    const categories = [category({})];
    const result = classify({}, categories);
    assert.equal(result.categoryCode, null);
    assert.match(result.rationale, /No confirmed text/);
  });
});
