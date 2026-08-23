import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksRegulatory } from "./regulatory-lookup";

describe("looksRegulatory", () => {
  it("flags a clause/standard question", () => {
    assert.equal(looksRegulatory("What's the nickel restriction under GSO?"), true);
  });

  it("flags the Arabic phrasing of a clause question", () => {
    assert.equal(looksRegulatory("ما هو الحد الأقصى للتركيز المسموح به؟"), true);
  });

  it("does not flag a plain platform question", () => {
    assert.equal(looksRegulatory("How do I download my certificate?"), false);
  });
});
