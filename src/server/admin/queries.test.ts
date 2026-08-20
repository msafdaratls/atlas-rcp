import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RequestState } from "@prisma/client";

import {
  allowedTransitionsFor,
  canReopenRequest,
  isLabTestingOnlyRequest,
  isScocOnlyRequest,
  onHoldResumeTarget,
  REOPEN_TARGET_STATES,
  REQUEST_TRANSITIONS,
} from "@/server/admin/queries";

const ALL_STATES = Object.keys(REQUEST_TRANSITIONS) as RequestState[];

describe("REQUEST_TRANSITIONS / allowedTransitionsFor — the request state machine", () => {
  it("matches REQUEST_TRANSITIONS exactly for every state with no SCOC/Lab-Testing special-casing in play", () => {
    for (const state of ALL_STATES) {
      if (state === "ON_HOLD") continue; // ON_HOLD is resume-target-derived, covered separately below
      const result = allowedTransitionsFor({ state, heldFromState: null, serviceCodes: ["SOME-OTHER-CODE"] });
      assert.deepEqual(
        result,
        REQUEST_TRANSITIONS[state],
        `allowedTransitionsFor(${state}) should match REQUEST_TRANSITIONS[${state}] for a non-special service`,
      );
    }
  });

  it("terminal states (DRAFT, RETURNED_TO_CLIENT, CLOSED, CANCELLED) allow no forward transition", () => {
    for (const state of ["DRAFT", "RETURNED_TO_CLIENT", "CLOSED", "CANCELLED"] as RequestState[]) {
      assert.deepEqual(allowedTransitionsFor({ state, heldFromState: null }), []);
    }
  });

  describe("ON_HOLD resume target", () => {
    it("resumes to heldFromState plus CANCELLED when heldFromState is recorded", () => {
      const result = allowedTransitionsFor({ state: "ON_HOLD", heldFromState: "TECHNICAL_REVIEW" });
      assert.deepEqual(result, ["TECHNICAL_REVIEW", "CANCELLED"]);
    });

    it("falls back to UNDER_INTAKE_REVIEW when heldFromState is null (legacy rows)", () => {
      const result = allowedTransitionsFor({ state: "ON_HOLD", heldFromState: null });
      assert.deepEqual(result, ["UNDER_INTAKE_REVIEW", "CANCELLED"]);
    });

    it("onHoldResumeTarget mirrors the same fallback", () => {
      assert.equal(onHoldResumeTarget("DECISION"), "DECISION");
      assert.equal(onHoldResumeTarget(null), "UNDER_INTAKE_REVIEW");
    });
  });

  describe("SCOC-only skip (ASSESSMENT_RUNNING -> DECISION, bypassing TECHNICAL_REVIEW)", () => {
    it("applies when every item is a SCOC service code", () => {
      const result = allowedTransitionsFor({
        state: "ASSESSMENT_RUNNING",
        heldFromState: null,
        serviceCodes: ["SAB-002"],
      });
      assert.deepEqual(result, ["DECISION", "ON_HOLD", "CANCELLED"]);
    });

    it("applies across both SCOC codes mixed together", () => {
      const result = allowedTransitionsFor({
        state: "ASSESSMENT_RUNNING",
        heldFromState: null,
        serviceCodes: ["SAB-002", "SFDA-COS-002"],
      });
      assert.deepEqual(result, ["DECISION", "ON_HOLD", "CANCELLED"]);
    });

    it("does NOT apply when a non-SCOC service is bundled in — falls through to the normal graph", () => {
      const result = allowedTransitionsFor({
        state: "ASSESSMENT_RUNNING",
        heldFromState: null,
        serviceCodes: ["SAB-002", "SAB-001"],
      });
      assert.deepEqual(result, REQUEST_TRANSITIONS.ASSESSMENT_RUNNING);
    });

    it("does NOT apply with an empty service-code list", () => {
      const result = allowedTransitionsFor({ state: "ASSESSMENT_RUNNING", heldFromState: null, serviceCodes: [] });
      assert.deepEqual(result, REQUEST_TRANSITIONS.ASSESSMENT_RUNNING);
    });
  });

  describe("Lab Testing-only skip (ASSESSMENT_RUNNING has no generic forward transition)", () => {
    it("applies when every item is LAB-001 — only ON_HOLD/CANCELLED via the generic button", () => {
      const result = allowedTransitionsFor({
        state: "ASSESSMENT_RUNNING",
        heldFromState: null,
        serviceCodes: ["LAB-001"],
      });
      assert.deepEqual(result, ["ON_HOLD", "CANCELLED"]);
    });

    it("does NOT apply when LAB-001 is bundled with another service", () => {
      const result = allowedTransitionsFor({
        state: "ASSESSMENT_RUNNING",
        heldFromState: null,
        serviceCodes: ["LAB-001", "SAB-001"],
      });
      assert.deepEqual(result, REQUEST_TRANSITIONS.ASSESSMENT_RUNNING);
    });
  });

  describe("isScocOnlyRequest / isLabTestingOnlyRequest", () => {
    it("are false for an empty code list (no false positive on an item-less request)", () => {
      assert.equal(isScocOnlyRequest([]), false);
      assert.equal(isLabTestingOnlyRequest([]), false);
    });

    it("are true only when every code matches", () => {
      assert.equal(isScocOnlyRequest(["SAB-002"]), true);
      assert.equal(isScocOnlyRequest(["SAB-002", "SAB-001"]), false);
      assert.equal(isLabTestingOnlyRequest(["LAB-001", "LAB-001"]), true);
      assert.equal(isLabTestingOnlyRequest(["LAB-001", "SAB-002"]), false);
    });
  });
});

describe("Reopen targets", () => {
  it("canReopenRequest is true only for the terminal states CLOSED/CANCELLED", () => {
    assert.equal(canReopenRequest("CLOSED"), true);
    assert.equal(canReopenRequest("CANCELLED"), true);
    assert.equal(canReopenRequest("DRAFT"), false);
    assert.equal(canReopenRequest("ON_HOLD"), false);
    assert.equal(canReopenRequest("REPORT_ISSUED"), false);
  });

  it("REOPEN_TARGET_STATES excludes DRAFT, ON_HOLD, and the terminal/closed-adjacent states themselves", () => {
    for (const excluded of ["DRAFT", "ON_HOLD", "CLOSED", "CANCELLED", "REPORT_ISSUED"] as RequestState[]) {
      assert.ok(
        !REOPEN_TARGET_STATES.includes(excluded),
        `REOPEN_TARGET_STATES should not include ${excluded}`,
      );
    }
  });
});
