import type { LabelVerdict } from "@prisma/client";
import { writeAuditLog } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Concurrency protection for the Label Evaluator (design doc §13.4). Nothing
 * in this repo does this today — `saveAssessment`
 * (src/server/admin/actions.ts) overwrites RequestItem.assessment
 * unconditionally with no lock or version check (design doc §13.1). That gap
 * is out of scope to fix, but this feature must not add a second fragile
 * writer, so it gets its own protection here rather than reusing anything.
 */

/**
 * Statuses that count as a live run and therefore block starting a new one.
 * Exported because every one of them must also have a stall-recovery
 * decision — see STALL_RECOVERY in recovery.ts, which is keyed on this type
 * so the two cannot drift apart.
 */
export const IN_FLIGHT_STATUSES = ["EXTRACTING", "AWAITING_REVIEW", "CLASSIFYING"] as const;

export type InFlightStatus = (typeof IN_FLIGHT_STATUSES)[number];

export class AlreadyClaimedError extends Error {
  constructor(public readonly claimedByUserId: string) {
    super(`Assessment is currently claimed by user ${claimedByUserId}`);
    this.name = "AlreadyClaimedError";
  }
}

export class InFlightRunExistsError extends Error {
  constructor(public readonly existingAssessmentId: string) {
    super(`An in-flight run already exists for this item: ${existingAssessmentId}`);
    this.name = "InFlightRunExistsError";
  }
}

/**
 * Soft claim: opening an item for review claims it for the current user
 * unless someone else already holds it, in which case the caller shows
 * "Currently being evaluated by {name}" and offers `force: true` to take
 * over. Never a hard lock — staff hand-offs are normal — but a take-over is
 * always logged so there's a record of who displaced whom.
 */
export async function claimAssessment(
  session: SessionUser,
  assessmentId: string,
  opts?: { force?: boolean },
): Promise<void> {
  const current = await prisma.labelAssessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: { claimedByUserId: true },
  });

  if (
    current.claimedByUserId &&
    current.claimedByUserId !== session.id &&
    !opts?.force
  ) {
    throw new AlreadyClaimedError(current.claimedByUserId);
  }

  const wasTakeover =
    !!current.claimedByUserId &&
    current.claimedByUserId !== session.id &&
    !!opts?.force;

  await prisma.labelAssessment.update({
    where: { id: assessmentId },
    data: { claimedByUserId: session.id, claimedAt: new Date() },
  });

  if (wasTakeover) {
    await writeAuditLog({
      session,
      action: "label_eval.assessment.claim_takeover",
      entityType: "LabelAssessment",
      entityId: assessmentId,
      before: { claimedByUserId: current.claimedByUserId },
      after: { claimedByUserId: session.id },
    });
  }
}

/**
 * Blocks starting a second concurrent extraction run on the same
 * RequestItem while one is still in flight (EXTRACTING / AWAITING_REVIEW /
 * CLASSIFYING) — the reviewer resumes the existing run instead of creating a
 * duplicate. Assessments that already reached ASSESSED /
 * BLOCKED_NO_CATEGORY_MATCH / ERROR don't count; a new run is allowed.
 */
export async function assertNoInFlightRun(requestItemId: string): Promise<void> {
  const existing = await prisma.labelAssessment.findFirst({
    where: {
      requestItemId,
      status: { in: [...IN_FLIGHT_STATUSES] },
    },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    throw new InFlightRunExistsError(existing.id);
  }
}

export class VerdictConflictError extends Error {
  constructor() {
    super("Verdict was changed by another reviewer since it was loaded");
    this.name = "VerdictConflictError";
  }
}

/**
 * Guarded verdict override — `updateMany` with an expected-previous-verdict
 * predicate, borrowing the same idiom this repo already uses for
 * request-state transitions (src/server/admin/actions.ts:333,616,859,989:
 * `updateMany({ where: { id, state: <expected> } })`, throwing on
 * `count === 0`). A blind `update` would silently clobber a concurrent
 * override the way `saveAssessment` clobbers RequestItem.assessment today —
 * this is the one place in the feature that must not repeat that pattern.
 */
export async function applyVerdictOverride(
  session: SessionUser,
  input: {
    assessmentId: string;
    kbRuleId: string;
    expectedPreviousVerdict: LabelVerdict;
    newVerdict: LabelVerdict;
    rationale?: string;
  },
): Promise<void> {
  const result = await prisma.labelItemVerdict.updateMany({
    where: {
      assessmentId: input.assessmentId,
      kbRuleId: input.kbRuleId,
      verdict: input.expectedPreviousVerdict,
    },
    data: {
      verdict: input.newVerdict,
      previousVerdict: input.expectedPreviousVerdict,
      autoOrManual: "manual_override",
      rationale: input.rationale,
      overriddenByUserId: session.id,
      overriddenAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new VerdictConflictError();
  }

  await writeAuditLog({
    session,
    action: "label_eval.verdict.override",
    entityType: "LabelItemVerdict",
    entityId: `${input.assessmentId}:${input.kbRuleId}`,
    before: { verdict: input.expectedPreviousVerdict },
    after: { verdict: input.newVerdict },
  });
}
