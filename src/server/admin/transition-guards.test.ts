import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkTransitionGuards } from "@/server/admin/transition-guards";

describe("checkTransitionGuards", () => {
  it("blocks RETURNED_TO_CLIENT with no reason codes", () => {
    const result = checkTransitionGuards({
      fromState: "UNDER_INTAKE_REVIEW",
      toState: "RETURNED_TO_CLIENT",
      reasonCodes: [],
      faultAttribution: "CLIENT_FAULT",
    });
    assert.deepEqual(result, { ok: false, error: "RETURN_REASON_REQUIRED" });
  });

  it("blocks RETURNED_TO_CLIENT with reason codes but no fault attribution", () => {
    const result = checkTransitionGuards({
      fromState: "UNDER_INTAKE_REVIEW",
      toState: "RETURNED_TO_CLIENT",
      reasonCodes: ["MISSING_ARTWORK"],
    });
    assert.deepEqual(result, { ok: false, error: "RETURN_REASON_REQUIRED" });
  });

  it("allows RETURNED_TO_CLIENT with both reason codes and fault attribution", () => {
    const result = checkTransitionGuards({
      fromState: "UNDER_INTAKE_REVIEW",
      toState: "RETURNED_TO_CLIENT",
      reasonCodes: ["MISSING_ARTWORK"],
      faultAttribution: "CLIENT_FAULT",
    });
    assert.deepEqual(result, { ok: true });
  });

  it("blocks CANCELLED with no note", () => {
    const result = checkTransitionGuards({
      fromState: "ACCEPTED",
      toState: "CANCELLED",
      reasonCodes: [],
    });
    assert.deepEqual(result, { ok: false, error: "CANCEL_NOTE_REQUIRED" });
  });

  it("allows CANCELLED with a note", () => {
    const result = checkTransitionGuards({
      fromState: "ACCEPTED",
      toState: "CANCELLED",
      reasonCodes: [],
      note: "Client withdrew the request",
    });
    assert.deepEqual(result, { ok: true });
  });

  it("blocks DECISION -> CLOSED (refusal) with no note", () => {
    const result = checkTransitionGuards({
      fromState: "DECISION",
      toState: "CLOSED",
      reasonCodes: [],
      coiAcknowledged: true,
    });
    assert.deepEqual(result, { ok: false, error: "REFUSAL_REASON_REQUIRED" });
  });

  it("does NOT require a note for CLOSED from any other from-state (only DECISION -> CLOSED is a refusal)", () => {
    const result = checkTransitionGuards({
      fromState: "REPORT_ISSUED",
      toState: "CLOSED",
      reasonCodes: [],
    });
    assert.deepEqual(result, { ok: true });
  });

  it("blocks every COI-gated transition with no acknowledgement", () => {
    const gated: Array<[string, string]> = [
      ["ASSESSMENT_RUNNING", "TECHNICAL_REVIEW"],
      ["ASSESSMENT_RUNNING", "DECISION"],
      ["TECHNICAL_REVIEW", "DECISION"],
      ["DECISION", "REPORT_ISSUED"],
    ];
    for (const [fromState, toState] of gated) {
      const result = checkTransitionGuards({
        fromState: fromState as never,
        toState: toState as never,
        reasonCodes: [],
        note: "note", // satisfy any note-based guard so only COI is under test
      });
      assert.deepEqual(
        result,
        { ok: false, error: "COI_ACKNOWLEDGEMENT_REQUIRED" },
        `${fromState} -> ${toState} should require COI acknowledgement`,
      );
    }
  });

  it("allows a COI-gated transition once acknowledged", () => {
    const result = checkTransitionGuards({
      fromState: "TECHNICAL_REVIEW",
      toState: "DECISION",
      reasonCodes: [],
      coiAcknowledged: true,
    });
    assert.deepEqual(result, { ok: true });
  });

  it("does not require COI acknowledgement for a non-gated transition", () => {
    const result = checkTransitionGuards({
      fromState: "SUBMITTED",
      toState: "UNDER_INTAKE_REVIEW",
      reasonCodes: [],
    });
    assert.deepEqual(result, { ok: true });
  });

  it("checks REFUSAL_REASON_REQUIRED and COI together — DECISION -> CLOSED needs both note and acknowledgement", () => {
    const missingBoth = checkTransitionGuards({
      fromState: "DECISION",
      toState: "CLOSED",
      reasonCodes: [],
    });
    assert.deepEqual(missingBoth, { ok: false, error: "REFUSAL_REASON_REQUIRED" });

    const missingCoi = checkTransitionGuards({
      fromState: "DECISION",
      toState: "CLOSED",
      reasonCodes: [],
      note: "Does not meet requirement X",
    });
    assert.deepEqual(missingCoi, { ok: false, error: "COI_ACKNOWLEDGEMENT_REQUIRED" });

    const bothSatisfied = checkTransitionGuards({
      fromState: "DECISION",
      toState: "CLOSED",
      reasonCodes: [],
      note: "Does not meet requirement X",
      coiAcknowledged: true,
    });
    assert.deepEqual(bothSatisfied, { ok: true });
  });
});
