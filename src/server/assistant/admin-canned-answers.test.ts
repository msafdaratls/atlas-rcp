import assert from "node:assert/strict";
import type { Role } from "@prisma/client";
import { describe, it } from "node:test";
import { buildAdminFallbackReply, matchCannedAnswer, matchCannedTopicId } from "./admin-canned-answers";

const ADMIN: Role[] = ["SYSTEM_ADMIN"];

/** Real phrasings of staff questions must reach the right topic, not merely some topic. */
const ROUTING: [string, Role[], string][] = [
  ["what is on the dashboard", ADMIN, "dashboard"],
  ["how do I pick up work", ADMIN, "work_queues"],
  ["how do I find a request", ADMIN, "requests_search"],
  ["how do I assign a request", ADMIN, "assign_request"],
  ["how do I put a request on hold", ADMIN, "hold_resume"],
  ["how do I cancel a request", ADMIN, "cancel_request"],
  ["what is the conflict of interest checkbox", ADMIN, "coi_gate"],
  ["how do I reopen a request", ADMIN, "reopen_request"],
  ["how do I search documents", ADMIN, "documents_search"],
  ["what is an engagement", ADMIN, "engagements"],
  ["how do I return a request to the client", ["INTAKE_OFFICER"], "return_to_client"],
  ["how do I create a client", ["INTAKE_OFFICER"], "create_client"],
  ["how do I complete the evaluation", ["EVALUATOR"], "complete_evaluation"],
  ["how do I complete testing", ["EVALUATOR"], "complete_testing"],
  ["how do I confirm a payment", ["FINANCE"], "finance_queue"],
  ["how do I create a coupon", ["CATALOGUE_MANAGER"], "coupons_manage"],
  ["how do I manage laboratories", ["CATALOGUE_MANAGER"], "laboratories_manage"],
  ["how do I invite staff", ["SYSTEM_ADMIN"], "settings_staff"],
  ["where is the audit log", ["SYSTEM_ADMIN"], "audit_log"],
  ["what is system health", ["SYSTEM_ADMIN"], "system_health"],
  ["كيف يتم إسناد طلب؟", ADMIN, "assign_request"],
  ["كيف أعلّق الطلب؟", ADMIN, "hold_resume"],
  ["ما هي صفحة الجودة؟", ["QUALITY_MANAGER"], "quality_page"],
];

describe("matchCannedAnswer (admin) routing", () => {
  for (const [question, roles, expected] of ROUTING) {
    it(`routes "${question}" to ${expected}`, () => {
      assert.equal(matchCannedTopicId(question, roles), expected);
    });
  }
});

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
    assert.equal(matchCannedAnswer("How do I complete application review?", ["FINANCE"]), null);
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
    assert.equal(matchCannedAnswer("Can you write me a poem about the sea?", ["SYSTEM_ADMIN"]), null);
  });
});

describe("buildAdminFallbackReply", () => {
  it("offers near-miss topics and stays inside the caller's roles", () => {
    const reply = buildAdminFallbackReply("something about a coupon", ["CATALOGUE_MANAGER"], "en");
    assert.match(reply, /coupon/);
  });

  it("never names a topic the caller's role cannot reach", () => {
    // Staff administration is SYSTEM_ADMIN-only, so an evaluator asking about
    // it must not even be told the topic exists.
    const evaluator = buildAdminFallbackReply("how do I invite staff", ["EVALUATOR"], "en");
    assert.doesNotMatch(evaluator, /invite staff/);
    // Same question, the role that does hold it: now it is offered.
    const admin = buildAdminFallbackReply("how do I invite staff", ["SYSTEM_ADMIN"], "en");
    assert.match(admin, /invite staff/);
  });

  it("answers in Arabic for an Arabic-locale user", () => {
    const reply = buildAdminFallbackReply("zzzz", ["EVALUATOR"], "ar");
    assert.match(reply, /مدير النظام/);
  });
});
