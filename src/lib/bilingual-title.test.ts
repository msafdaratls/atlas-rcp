import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bilingualTitle, isMeaningfulTitle, normaliseTitle } from "./bilingual-title";

// The real row this exists for: GSO 2528 claim CLAIM-GEN-4-2, whose English
// column is the literal "0" while the Arabic carries the actual question.
const CLAIM_AR = "هل هناك ربط مباشر بين الدراسات المرجعية وبين المستحضر النهائي؟";

describe("isMeaningfulTitle", () => {
  it("accepts ordinary titles in either script", () => {
    assert.equal(isMeaningfulTitle("Is the claim free from implying effects on metabolism?"), true);
    assert.equal(isMeaningfulTitle(CLAIM_AR), true);
  });

  it("rejects the literal \"0\" placeholder the claims workbook uses", () => {
    assert.equal(isMeaningfulTitle("0"), false);
    assert.equal(isMeaningfulTitle(" 0 "), false);
  });

  it("rejects blanks and absent values", () => {
    assert.equal(isMeaningfulTitle(""), false);
    assert.equal(isMeaningfulTitle("   "), false);
    assert.equal(isMeaningfulTitle(null), false);
    assert.equal(isMeaningfulTitle(undefined), false);
  });

  it("rejects the other placeholder tokens, case-insensitively", () => {
    assert.equal(isMeaningfulTitle("-"), false);
    assert.equal(isMeaningfulTitle("N/A"), false);
    assert.equal(isMeaningfulTitle("n/a"), false);
  });

  it("does NOT reject real text that merely contains a placeholder token", () => {
    assert.equal(isMeaningfulTitle("0% alcohol declaration present?"), true);
    assert.equal(isMeaningfulTitle("Non-applicable claims are excluded"), true);
  });
});

describe("bilingualTitle — the reviewer must never see a bare digit as the question", () => {
  it("returns the reader's own language when it is present", () => {
    assert.equal(bilingualTitle("English question", "سؤال عربي", false), "English question");
    assert.equal(bilingualTitle("English question", "سؤال عربي", true), "سؤال عربي");
  });

  it("falls back to Arabic when the English is the \"0\" placeholder — the reported bug", () => {
    assert.equal(bilingualTitle("0", CLAIM_AR, false), CLAIM_AR);
  });

  it("falls back to English when the Arabic is missing", () => {
    assert.equal(bilingualTitle("English question", null, true), "English question");
    assert.equal(bilingualTitle("English question", "0", true), "English question");
  });

  it("returns the supplied fallback (the rule code) when neither language is usable", () => {
    assert.equal(bilingualTitle("0", "", false, "CLAIM-GEN-4-2"), "CLAIM-GEN-4-2");
    assert.equal(bilingualTitle(null, null, true, "CLAIM-GEN-4-2"), "CLAIM-GEN-4-2");
  });

  it("returns an empty string rather than undefined when no fallback is given", () => {
    assert.equal(bilingualTitle(null, null, false), "");
  });

  it("trims surrounding whitespace off whichever value it picks", () => {
    assert.equal(bilingualTitle("  spaced  ", null, false), "spaced");
  });
});

describe("normaliseTitle — keeps placeholders out of storage", () => {
  it("nulls a placeholder so the LLM prompt and KB search see an absent value", () => {
    assert.equal(normaliseTitle("0"), null);
    assert.equal(normaliseTitle("  "), null);
    assert.equal(normaliseTitle(undefined), null);
  });

  it("passes real text through, trimmed", () => {
    assert.equal(normaliseTitle("  Real claim text  "), "Real claim text");
    assert.equal(normaliseTitle(CLAIM_AR), CLAIM_AR);
  });
});
