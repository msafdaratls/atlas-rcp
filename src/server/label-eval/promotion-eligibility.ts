import type { LabelVerdict } from "@prisma/client";

/**
 * A verdict is eligible to be written to the official checklist (design doc
 * §13.3) only when BOTH: its value is one `saveAssessment` accepts
 * (COMPLIANT/NON_COMPLIANT/NA — NEEDS_REVIEW/REQUIRES_ADDITIONAL_DATA are
 * never coerced), AND a human has actually looked at it.
 *
 * `autoOrManual: "llm_proposed"` fails that second test: the AI proposed a
 * verdict, but nobody has confirmed or changed it yet — exactly the state
 * design doc §1 Principle 2 says must never reach a final decision on its
 * own ("an LLM may propose, never silently decide"). Once a reviewer either
 * confirms it as-is (confirmProposedVerdict → "llm_confirmed") or changes it
 * (overrideItemVerdict → "manual_override"), it becomes eligible — same as
 * any deterministic "auto" verdict a rule-based evaluator produced with no
 * LLM involved at all.
 *
 * Without this check, planPromotion (actions.ts) would treat an
 * LLM-proposed-and-never-reviewed COMPLIANT/NON_COMPLIANT exactly like a
 * human-confirmed one and promote it straight into the official record.
 */
export function isPromotableVerdict(
  verdict: LabelVerdict,
  autoOrManual: string,
): verdict is "COMPLIANT" | "NON_COMPLIANT" | "NA" {
  const hasPromotableValue = verdict === "COMPLIANT" || verdict === "NON_COMPLIANT" || verdict === "NA";
  return hasPromotableValue && autoOrManual !== "llm_proposed";
}
