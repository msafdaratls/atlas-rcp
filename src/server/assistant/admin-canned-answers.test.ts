import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchCannedAnswer } from "./admin-canned-answers";

describe("matchCannedAnswer (admin)", () => {
  it("matches a generic question for any staff role", () => {
    const result = matchCannedAnswer("How do I assign a request?", ["EVALUATOR"]);
    assert.ok(result);
    assert.match(result.en, /Assign/);
  });

  it("matches the Arabic phrasing of the same question", () => {
    const result = matchCannedAnswer("كيف يتم إسناد طلب؟", ["EVALUATOR"]);
    assert.ok(result);
    assert.match(result.ar, /الإسناد/);
  });

  it("matches a role-restricted entry when the caller holds that role", () => {
    const result = matchCannedAnswer("How do I complete application review?", ["INTAKE_OFFICER"]);
    assert.ok(result);
    assert.match(result.en, /Complete Application Review/);
  });

  it("does not match a role-restricted entry for a role that doesn't hold it", () => {
    const result = matchCannedAnswer("How do I complete application review?", ["FINANCE"]);
    assert.equal(result, null);
  });

  it("matches a role-restricted entry when the caller holds any of several roles", () => {
    const result = matchCannedAnswer("How do I create a coupon?", ["EVALUATOR", "CATALOGUE_MANAGER"]);
    assert.ok(result);
    assert.match(result.en, /Create Coupon/);
  });

  it("SYSTEM_ADMIN gets role-restricted entries meant for other roles too", () => {
    const result = matchCannedAnswer("How do I confirm a payment?", ["SYSTEM_ADMIN"]);
    assert.ok(result);
    assert.match(result.en, /Confirm/);
  });

  it("returns null on an unrelated message with no keyword hit", () => {
    const result = matchCannedAnswer("Can you write me a poem about the sea?", ["SYSTEM_ADMIN"]);
    assert.equal(result, null);
  });
});
