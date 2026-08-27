import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ingredientLookup } from "./cosmetics";
import type { RuleContext } from "./registry";

function makeCtx(ingredientsText: string, lookups: RuleContext["lookups"]): RuleContext {
  return {
    code: "TEST",
    section: null,
    titleEn: null,
    titleAr: "",
    payload: {},
    fields: { ingredients_list: { en: ingredientsText } },
    classification: null,
    lookups,
    llmProposals: {},
  };
}

const annexIILookups: RuleContext["lookups"] = [
  {
    tableKey: "cosing_annex_ii",
    payload: {
      ingredient: "Alanroot oil (Inula helenium L.) (CAS No 97676-35-2), when used as a fragrance ingredient",
    },
  },
  {
    tableKey: "cosing_annex_ii",
    payload: {
      ingredient: "Paraffin waxes (coal), brown-coal high-temp. tar, if they contain > 0.005 % w/w benzo[a]pyrene",
    },
  },
  {
    tableKey: "cosing_annex_ii",
    payload: { ingredient: "4-Aminosalicylic acid and its salts" },
  },
  {
    tableKey: "cosing_annex_ii",
    payload: { ingredient: "Formaldehyde" },
  },
];

describe("ingredientLookup (COSING Annex II/III screen)", () => {
  it("does not flag a generic ingredient that merely shares a word with a qualified Annex II entry", () => {
    // Real prod false positive: "Fragrance" matched "... when used as a fragrance ingredient".
    const result = ingredientLookup(makeCtx("Aqua, Fragrance, Glycerin", annexIILookups));
    assert.equal(result.verdict, "COMPLIANT");
  });

  it("does not flag generic Paraffin against a narrow coal-tar paraffin wax entry", () => {
    const result = ingredientLookup(makeCtx("Paraffin, Aqua", annexIILookups));
    assert.equal(result.verdict, "COMPLIANT");
  });

  it("does not flag Salicylic Acid against the unrelated 4-Aminosalicylic acid entry", () => {
    const result = ingredientLookup(makeCtx("Salicylic Acid, Aqua", annexIILookups));
    assert.equal(result.verdict, "COMPLIANT");
  });

  it("still flags an exact single-word substance match against Annex II", () => {
    const result = ingredientLookup(makeCtx("Aqua, Formaldehyde", annexIILookups));
    assert.equal(result.verdict, "NON_COMPLIANT");
    assert.equal(result.evidenceText, "Formaldehyde");
  });

  it("still flags a genuinely matching multi-word substance name", () => {
    const result = ingredientLookup(makeCtx("Aqua, 4-Aminosalicylic acid", annexIILookups));
    assert.equal(result.verdict, "NON_COMPLIANT");
  });
});
