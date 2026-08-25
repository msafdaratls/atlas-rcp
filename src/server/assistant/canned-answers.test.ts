import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFallbackReply, matchCannedAnswer, matchCannedTopicId } from "./canned-answers";

/**
 * The bank is the whole assistant while the AI fallback is off, so the
 * headline test is coverage: real phrasings of the questions a client
 * actually asks must reach the *right* topic, not merely some topic.
 */
const ROUTING: [string, string][] = [
  ["How do I submit a new request?", "new_request"],
  ["how to submit request", "new_request"],
  ["where do i apply", "new_request"],
  ["What are the steps in the wizard?", "wizard_steps"],
  ["which service do I need?", "choose_service"],
  ["how do I upload documents", "upload_documents"],
  ["can I upload a word file?", "file_types"],
  ["is there a template for the declaration form", "document_templates"],
  ["I have a discount code, where do I put it?", "coupon"],
  ["what is a draft", "draft"],
  ["my request was returned, what do I do", "returned_to_client"],
  ["how do I resubmit", "returned_to_client"],
  ["how many times can I resubmit?", "resubmit_limit"],
  ["how do I check my request status", "check_status"],
  ["what does under intake review mean", "request_states"],
  ["how long does it take", "sla_timeline"],
  ["why is my request on hold", "on_hold"],
  ["I made a mistake in the product name", "edit_product_details"],
  ["how do I reopen a closed request", "reopen_request"],
  ["how do I message the reviewer", "messages"],
  ["where do I download my certificate", "certificate_download"],
  ["how do I verify a certificate", "verify_certificate"],
  ["show me my reports", "reports_page"],
  ["where are my invoices", "payment_invoice"],
  ["how do I pay", "how_to_pay"],
  ["what is my balance", "statement"],
  ["how much does it cost", "pricing_vat"],
  ["how do I change my company address", "company_profile"],
  ["how do I invite a colleague", "company_users"],
  ["what are the user roles", "client_roles"],
  ["where do I save my SABER account", "gov_credentials"],
  ["how do I turn off email notifications", "notification_preferences"],
  ["I can't sign in", "account_access"],
  ["how does the assessment work", "how_assessment_works"],
  ["is my data safe", "privacy_data"],
  ["how do I contact support", "contact_support"],
  // Arabic phrasings of the same portal, including inflected forms.
  ["كيف أقدم طلب جديد؟", "new_request"],
  ["كيف أتابع حالة طلبي؟", "check_status"],
  ["أين أجد فواتيري؟", "payment_invoice"],
  ["كيف أدفع؟", "how_to_pay"],
  ["كيف أرفع المستندات؟", "upload_documents"],
  ["أُعيد طلبي للتصحيح ماذا أفعل؟", "returned_to_client"],
  ["كيف أحمّل الشهادة؟", "certificate_download"],
  ["كيف أتواصل مع الدعم؟", "contact_support"],
  ["كم يستغرق الطلب؟", "sla_timeline"],
  // Regressions found in review: each of these returned the wrong topic or
  // nothing at all. See keyword-match.test.ts for the underlying rules.
  ["how do I change my password on my profile", "account_access"],
  ["إلغاء الطلب", "cancel_request"],
  ["هل يمكنني إلغاء الطلب؟", "cancel_request"],
  ["أين رسائل الطلب؟", "messages"],
  ["متى يكون جاهزاً؟", "sla_timeline"],
  ["نظرة عامة على البوابة", "portal_overview"],
];

describe("matchCannedAnswer routing", () => {
  for (const [question, expected] of ROUTING) {
    it(`routes "${question}" to ${expected}`, () => {
      assert.equal(matchCannedTopicId(question), expected);
    });
  }
});

describe("matchCannedAnswer", () => {
  it("returns both languages for a match", () => {
    const result = matchCannedAnswer("How do I submit a new request?");
    assert.ok(result);
    assert.match(result.en, /New request/);
    assert.match(result.ar, /طلب جديد/);
  });

  it("defers a service-specific question to the AI when the AI is on", () => {
    const result = matchCannedAnswer("What documents do I need for a Cosmetics SCOC request?", {
      deferSpecificServiceToAi: true,
    });
    assert.equal(result, null);
  });

  it("defers a service-code question to the AI when the AI is on", () => {
    assert.equal(matchCannedAnswer("What's the SLA for SAB-001?", { deferSpecificServiceToAi: true }), null);
  });

  it("still answers a service-specific question when the AI is off, rather than dead-ending", () => {
    // Nothing better to fall through to, so the generic timeline answer beats silence.
    const result = matchCannedAnswer("What's the SLA for SAB-001?");
    assert.ok(result);
  });

  it("returns null on an unrelated message with no keyword hit", () => {
    assert.equal(matchCannedAnswer("Can you write me a poem about the sea?"), null);
  });
});

describe("buildFallbackReply", () => {
  it("offers the topics closest to what was actually asked", () => {
    const reply = buildFallbackReply("something about an invoice I suppose", "en");
    assert.match(reply, /invoice/);
    assert.match(reply, /Support/);
  });

  it("falls back to headline topics when nothing is even close", () => {
    const reply = buildFallbackReply("zzzz", "en");
    assert.match(reply, /submit a request/);
  });

  it("answers in Arabic for an Arabic-locale user", () => {
    const reply = buildFallbackReply("zzzz", "ar");
    assert.match(reply, /الدعم/);
    assert.match(reply, /طلب جديد/);
  });
});
