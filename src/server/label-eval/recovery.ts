import type { LabelAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import type { InFlightStatus } from "@/server/label-eval/concurrency";

/**
 * Heals assessments stranded in a transient status.
 *
 * `confirmFieldsAndRunAssessment` now restores AWAITING_REVIEW when the rule
 * engine throws, but a handler only runs if the process survives to run it.
 * A deploy, an OOM kill, or a container restart in the middle of a run skips
 * it entirely and leaves the row in CLASSIFYING — which
 * `IN_FLIGHT_STATUSES` (concurrency.ts) treats as a live run, so the reviewer
 * can neither re-run the assessment (the action admits only AWAITING_REVIEW)
 * nor start a fresh one. Without a sweep the only way out is a manual DB
 * update.
 *
 * This mirrors the stale-PROCESSING reclaim `processExtractionJobBatch`
 * already performs on the job table (extraction/worker.ts) — the same
 * problem one layer up, solved the same way, on the same cron tick.
 */

/**
 * Must exceed the longest run that can still legitimately be in progress,
 * because reclaiming a live run would let a second one start alongside it.
 *
 * Worst case, derived rather than guessed: a cosmetics run sends its
 * judgment rules to the model in batches of MAX_RULES_PER_CALL = 40
 * (llm/judgment-proposals.ts) — ~4 batches for the current KB — plus one
 * classification call. Each call carries a 45s timeout (lib/anthropic-client.ts)
 * and the SDK retries twice, so a fully pathological call is ~135s and a
 * fully pathological run lands around 11 minutes.
 *
 * 30 minutes keeps roughly a 2.5x margin over that while still clearing a
 * stall inside the same working session. Deliberately far more generous than
 * the job table's 5 minutes (extraction/worker.ts), which guards a queue
 * whose work is retried rather than a run that holds a reviewer's confirmed
 * data. If MAX_RULES_PER_CALL, the KB size, or the client timeout grows
 * substantially, re-derive this.
 */
const STALL_AFTER_MS = 30 * 60 * 1000;

/**
 * What happens to an assessment left sitting in each in-flight status. Typed
 * as a total map over InFlightStatus so adding a transient status to
 * IN_FLIGHT_STATUSES without deciding how a stalled one recovers is a
 * compile error rather than another silently unreachable row.
 *
 * "reviewer-actionable" means no sweep is needed: the reviewer can already
 * move the item themselves from that status, so leaving it alone is correct.
 */
export const STALL_RECOVERY = {
  // The reviewer's own queue — they confirm fields and re-run at will.
  AWAITING_REVIEW: "reviewer-actionable",
  // Extraction never delivered fields, so there is nothing to review.
  EXTRACTING: "ERROR",
  // Fields are confirmed and intact; hand the item back to be re-run.
  CLASSIFYING: "AWAITING_REVIEW",
  // A hand-worked run. There is no background step to stall: the evaluator is
  // the only thing that moves it, and a run legitimately sits here across
  // days while they gather evidence. Sweeping it would destroy work in
  // progress, so it is left alone by design.
  MANUAL_IN_PROGRESS: "reviewer-actionable",
  // `as const` keeps each value's literal type so it can be handed straight
  // to Prisma; `satisfies` still fails the build if a status is missing.
} as const satisfies Record<InFlightStatus, "reviewer-actionable" | LabelAssessmentStatus>;

export type ReclaimResult = { classifying: number; extracting: number };

export async function reclaimStalledAssessments(now: Date = new Date()): Promise<ReclaimResult> {
  const stalledBefore = new Date(now.getTime() - STALL_AFTER_MS);

  // CLASSIFYING is only ever set immediately before the cosmetics rule engine
  // runs, so a stale row here means that run died. The reviewer's confirmed
  // field values are still intact, so hand the item back to them rather than
  // failing it outright — re-running costs one click and no re-entry.
  const classifying = await prisma.labelAssessment.updateMany({
    where: { status: "CLASSIFYING", updatedAt: { lt: stalledBefore } },
    data: { status: STALL_RECOVERY.CLASSIFYING },
  });

  // EXTRACTING is the normal state while the extraction job is queued, and a
  // job may legitimately sit PENDING through backoff for up to ~12 minutes,
  // so staleness alone is not evidence of a stall. Only an assessment whose
  // job can no longer make progress — dead-lettered, or the row missing
  // altogether — is genuinely stranded. ERROR (not AWAITING_REVIEW) is the
  // honest landing state: extraction never produced fields to review, and
  // ERROR is outside IN_FLIGHT_STATUSES, so a fresh run is unblocked.
  const extracting = await prisma.labelAssessment.updateMany({
    where: {
      status: "EXTRACTING",
      updatedAt: { lt: stalledBefore },
      OR: [{ extractionJob: { is: null } }, { extractionJob: { status: "FAILED" } }],
    },
    data: { status: STALL_RECOVERY.EXTRACTING },
  });

  if (classifying.count > 0 || extracting.count > 0) {
    log.warn("label-eval.recovery", "reclaimed stalled assessments", {
      classifyingToAwaitingReview: classifying.count,
      extractingToError: extracting.count,
    });
  }

  return { classifying: classifying.count, extracting: extracting.count };
}
