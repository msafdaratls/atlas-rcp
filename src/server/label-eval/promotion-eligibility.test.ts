import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPromotableVerdict } from "./promotion-eligibility";

describe("isPromotableVerdict — the promotion-safety gate for AI-proposed verdicts", () => {
  it("allows a deterministic (non-LLM) verdict through", () => {
    assert.equal(isPromotableVerdict("COMPLIANT", "auto"), true);
    assert.equal(isPromotableVerdict("NON_COMPLIANT", "auto"), true);
    assert.equal(isPromotableVerdict("NA", "auto"), true);
  });

  it("allows a human-changed verdict through", () => {
    assert.equal(isPromotableVerdict("COMPLIANT", "manual_override"), true);
  });

  it("allows an LLM proposal a human explicitly confirmed", () => {
    assert.equal(isPromotableVerdict("NON_COMPLIANT", "llm_confirmed"), true);
  });

  it("BLOCKS an LLM-proposed verdict nobody has looked at yet — the core safety property", () => {
    assert.equal(isPromotableVerdict("COMPLIANT", "llm_proposed"), false);
    assert.equal(isPromotableVerdict("NON_COMPLIANT", "llm_proposed"), false);
    assert.equal(isPromotableVerdict("NA", "llm_proposed"), false);
  });

  it("blocks non-final verdict values regardless of autoOrManual", () => {
    assert.equal(isPromotableVerdict("NEEDS_REVIEW", "auto"), false);
    assert.equal(isPromotableVerdict("REQUIRES_ADDITIONAL_DATA", "manual_override"), false);
    assert.equal(isPromotableVerdict("NEEDS_REVIEW", "llm_proposed"), false);
  });
});
