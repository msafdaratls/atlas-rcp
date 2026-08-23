import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchCannedAnswer } from "./canned-answers";

describe("matchCannedAnswer", () => {
  it("matches a generic platform question", () => {
    const result = matchCannedAnswer("How do I submit a new request?");
    assert.ok(result);
    assert.match(result.en, /New Request/);
  });

  it("matches the Arabic phrasing of the same question", () => {
    const result = matchCannedAnswer("كيف أقدم طلب جديد؟");
    assert.ok(result);
    assert.match(result.ar, /طلب جديد/);
  });

  it("returns null when the message names a specific service, even if it also hits a keyword", () => {
    const result = matchCannedAnswer("What documents do I need for a Cosmetics SCOC request?");
    assert.equal(result, null);
  });

  it("returns null when the message names a service code", () => {
    const result = matchCannedAnswer("What's the SLA for SAB-001?");
    assert.equal(result, null);
  });

  it("returns null on an unrelated message with no keyword hit", () => {
    const result = matchCannedAnswer("Can you write me a poem about the sea?");
    assert.equal(result, null);
  });

  it("returns null on an ambiguous tie between two entries", () => {
    // "invoice" scores payment_invoice and "notifications" scores notifications —
    // both hit once, so this asserts the tie-breaks-to-null path directly.
    const result = matchCannedAnswer("invoice notifications");
    assert.equal(result, null);
  });
});
