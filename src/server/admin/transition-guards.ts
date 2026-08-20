import type { FaultAttribution, RequestState, ReturnReasonCode } from "@prisma/client";

/**
 * Transitions the spec requires a mandatory Conflict of Interest Declaration
 * before: completing Evaluation, completing Technical Review, and saving a
 * Certification Decision (both Grant and Refuse).
 */
export const COI_GATED_TRANSITIONS: Array<[RequestState, RequestState]> = [
  ["ASSESSMENT_RUNNING", "TECHNICAL_REVIEW"],
  // SCOC skip: completing Evaluation lands directly on Decision, so the same
  // COI declaration required for a normal "complete Evaluation" applies here.
  ["ASSESSMENT_RUNNING", "DECISION"],
  ["TECHNICAL_REVIEW", "DECISION"],
  ["DECISION", "REPORT_ISSUED"],
  ["DECISION", "CLOSED"],
];

export type TransitionGuardInput = {
  fromState: RequestState;
  toState: RequestState;
  note?: string;
  reasonCodes: ReturnReasonCode[];
  faultAttribution?: FaultAttribution;
  coiAcknowledged?: true;
};

export type TransitionGuardError =
  | "RETURN_REASON_REQUIRED"
  | "CANCEL_NOTE_REQUIRED"
  | "REFUSAL_REASON_REQUIRED"
  | "COI_ACKNOWLEDGEMENT_REQUIRED";

export type TransitionGuardResult =
  | { ok: true }
  | { ok: false; error: TransitionGuardError };

/**
 * The pure, DB-free half of transitionAdminRequest's guard checks — given
 * only what the caller already has in hand (the states involved and the form
 * input), not anything that needs a query. Kept separate from
 * transitionAdminRequest specifically so these rules are unit-testable
 * without a database: this is the state-machine logic that has produced the
 * most "Fix X gate" one-off commits historically, precisely because it used
 * to be untestable inline.
 *
 * DB-dependent guards (evaluation report presence, certificate attachment,
 * technical review checklist completeness) stay in transitionAdminRequest —
 * they need a query result these functions don't have.
 */
export function checkTransitionGuards(
  input: TransitionGuardInput,
): TransitionGuardResult {
  if (
    input.toState === "RETURNED_TO_CLIENT" &&
    (input.reasonCodes.length === 0 || !input.faultAttribution)
  ) {
    return { ok: false, error: "RETURN_REASON_REQUIRED" };
  }

  if (input.toState === "CANCELLED" && !input.note) {
    return { ok: false, error: "CANCEL_NOTE_REQUIRED" };
  }

  // Refusing certification (DECISION -> CLOSED) must carry a reason, same
  // rule as CANCELLED — this is the "Refuse Certification" path.
  if (input.fromState === "DECISION" && input.toState === "CLOSED" && !input.note) {
    return { ok: false, error: "REFUSAL_REASON_REQUIRED" };
  }

  if (
    COI_GATED_TRANSITIONS.some(
      ([from, to]) => from === input.fromState && to === input.toState,
    ) &&
    !input.coiAcknowledged
  ) {
    return { ok: false, error: "COI_ACKNOWLEDGEMENT_REQUIRED" };
  }

  return { ok: true };
}
