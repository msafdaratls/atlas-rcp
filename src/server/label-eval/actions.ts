"use server";

import type { LabelEvalDomain, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { requirePermission } from "@/lib/rbac";
import { computeDocumentsFingerprint } from "@/server/label-eval/fingerprint";
import { DOCUMENT_KIND_BY_REQUIRED_CODE } from "@/server/label-eval/fields";
import { ingestRequestItemDocuments } from "@/server/label-eval/storage";
import {
  assertRequestItemEvaluable,
  computeLiveFingerprint,
  EvaluationUnavailableError,
} from "@/server/label-eval/queries";
import {
  assertNoInFlightRun,
  InFlightRunExistsError,
  applyVerdictOverride,
  VerdictConflictError,
  claimAssessment,
  AlreadyClaimedError,
} from "@/server/label-eval/concurrency";
import { mandatoryFieldKeys } from "@/server/label-eval/fields";
import { runSfdaRuleEngine, recomputeSfdaScore } from "@/server/label-eval/evaluators/run-sfda";
import { runCosmeticsRuleEngine, recomputeCosmeticsScore, applyRequiredTests } from "@/server/label-eval/evaluators/run-cosmetics";
import { saveAssessment } from "@/server/admin/actions";
import { parseAssessment, parseCheckSets } from "@/lib/assessment";
import { isPromotableVerdict } from "@/server/label-eval/promotion-eligibility";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Where an assessment's workspace lives. AI runs keep their per-domain
 * routes; manual runs share one route because their page is domain-generic.
 * Every revalidatePath in this file goes through here so a new route can
 * never be added in one place and forgotten in another.
 */
function workspacePath(method: "AI" | "MANUAL", domain: LabelEvalDomain, assessmentId: string): string {
  if (method === "MANUAL") return `/[locale]/admin/label-evaluator/manual/${assessmentId}`;
  const basePath = domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";
  return `/[locale]/admin/label-evaluator/${basePath}/${assessmentId}`;
}

const startAssessmentSchema = z.object({
  requestItemId: z.string().min(1),
  domain: z.enum(["SFDA_SUPPLEMENTS", "COSMETICS"]),
});

/**
 * Kicks off one evaluation run (design doc §2, steps 1-2): re-verifies the
 * item is evaluable, blocks a duplicate in-flight run, copies the source
 * documents into evaluator-owned storage (never a reference — design doc
 * §3), and creates the LabelAssessment + LabelDocument rows + the
 * LabelExtractionJob in one transaction. Returns immediately — extraction
 * itself runs async on the next worker tick (design doc §5); the caller
 * polls assessment status rather than blocking on this call.
 */
export async function startLabelAssessment(
  input: z.infer<typeof startAssessmentSchema>,
): Promise<ActionResult<{ assessmentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = startAssessmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, domain } = parsed.data;

    let evaluable: Awaited<ReturnType<typeof assertRequestItemEvaluable>>;
    try {
      evaluable = await assertRequestItemEvaluable(requestItemId, domain);
    } catch (e) {
      if (e instanceof EvaluationUnavailableError) {
        return { ok: false, error: `NOT_EVALUABLE:${e.currentState}` };
      }
      if (e instanceof Error && e.message === "WRONG_DOMAIN") {
        return { ok: false, error: "WRONG_DOMAIN" };
      }
      return { ok: false, error: "NOT_FOUND" };
    }

    try {
      await assertNoInFlightRun(requestItemId);
    } catch (e) {
      if (e instanceof InFlightRunExistsError) {
        return { ok: false, error: `IN_FLIGHT:${e.existingAssessmentId}:${e.existingMethod}` };
      }
      throw e;
    }

    const activeKb = await prisma.labelKbVersion.findFirst({
      where: { domain, status: "ACTIVE" },
      orderBy: { activatedAt: "desc" },
    });
    if (!activeKb) return { ok: false, error: "NO_ACTIVE_DATASET" };

    const item = await prisma.requestItem.findUniqueOrThrow({
      where: { id: evaluable.requestItemId },
      select: {
        request: {
          select: { requestNo: true, organisation: { select: { id: true, nameEn: true } } },
        },
        serviceItem: { select: { code: true } },
      },
    });

    let ingested: Awaited<ReturnType<typeof ingestRequestItemDocuments>>;
    try {
      ingested = await ingestRequestItemDocuments(
        requestItemId,
        DOCUMENT_KIND_BY_REQUIRED_CODE[domain],
      );
    } catch {
      return { ok: false, error: "SOURCE_DOCUMENT_UNREADABLE" };
    }
    if (ingested.length === 0) return { ok: false, error: "NO_DOCUMENTS" };

    const fingerprint = computeDocumentsFingerprint(ingested.map((d) => d.sha256));

    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.labelAssessment.create({
        data: {
          domain,
          kbVersionId: activeKb.id,
          requestItemId: evaluable.requestItemId,
          requestNo: item.request.requestNo,
          organisationId: item.request.organisation.id,
          organisationName: item.request.organisation.nameEn,
          serviceItemCode: item.serviceItem.code,
          documentsFingerprint: fingerprint,
          createdByUserId: session.id,
          claimedByUserId: session.id,
          claimedAt: new Date(),
        },
      });
      await tx.labelDocument.createMany({
        data: ingested.map((d) => ({
          assessmentId: created.id,
          kind: d.kind,
          sourceDocumentVersionId: d.sourceDocumentVersionId,
          fileName: d.fileName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          storageKey: d.storageKey,
          sha256: d.sha256,
        })),
      });
      await tx.labelExtractionJob.create({ data: { assessmentId: created.id } });
      // Record the route on the item, so the request page and the queue agree
      // with what actually happened even if nobody chose beforehand.
      await tx.requestItem.update({
        where: { id: evaluable.requestItemId },
        data: { assessmentMethod: "AI" },
      });
      return created;
    });

    await writeAuditLog({
      session,
      action: "label_eval.assessment.start",
      entityType: "LabelAssessment",
      entityId: assessment.id,
      organisationId: item.request.organisation.id,
      after: { domain, requestItemId, kbVersionId: activeKb.id },
    });

    revalidatePath(`/[locale]/admin/label-evaluator/${domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}`, "page");

    return { ok: true, data: { assessmentId: assessment.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "START_FAILED" };
  }
}

const retryExtractionSchema = z.object({ assessmentId: z.string().min(1) });

/**
 * Requeues extraction for an assessment that dead-lettered into ERROR.
 *
 * ERROR is reachable two ways: the extraction job exhausted its three
 * attempts (extraction/worker.ts), or the recovery sweep found an EXTRACTING
 * row whose job can no longer progress (recovery.ts's STALL_RECOVERY). Until
 * now nothing could move a row back out of it — no action admitted the
 * status and the workspace rendered a bare red panel — so the only way out
 * was a manual DB update.
 *
 * That was survivable while ManualEntryProvider was the only configured
 * provider, because it cannot fail: it returns needsReview fields without
 * doing any I/O. Pointing LABEL_EVAL_EXTRACTION_PROVIDER at a real provider
 * makes a genuinely failed extraction reachable (API outage, rate limit,
 * unreadable artwork), and stranding a reviewer's run on one is not an
 * acceptable outcome for a transient upstream problem.
 *
 * Resets `attempts` so the reviewer gets a full set of retries rather than
 * one immediately-dead-lettering attempt, and clears `lastError` so a stale
 * message can't be mistaken for the result of this run.
 */
export async function retryExtraction(
  input: z.infer<typeof retryExtractionSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = retryExtractionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { assessmentId } = parsed.data;

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, domain: true, status: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.status !== "ERROR") return { ok: false, error: "INVALID_STATE" };

    // One transaction so the status flip and the requeue cannot land apart:
    // an assessment moved to EXTRACTING with no runnable job behind it is
    // stranded until the recovery sweep drags it back half an hour later.
    const requeued = await prisma.$transaction(async (tx) => {
      // Guarded on status so two reviewers clicking retry together produce
      // one requeue, not two — the loser matches nothing and rolls back
      // before either write touches the job row.
      const claimed = await tx.labelAssessment.updateMany({
        where: { id: assessmentId, status: "ERROR" },
        data: { status: "EXTRACTING" },
      });
      if (claimed.count === 0) return false;

      // upsert, not update: recovery.ts sends an assessment to ERROR when the
      // job row is dead-lettered OR missing altogether, and an `update` on the
      // missing case would throw after the status flip had already committed.
      await tx.labelExtractionJob.upsert({
        where: { assessmentId },
        create: { assessmentId },
        update: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() },
      });
      return true;
    });
    if (!requeued) return { ok: false, error: "INVALID_STATE" };

    await writeAuditLog({
      session,
      action: "label_eval.extraction.retry",
      entityType: "LabelAssessment",
      entityId: assessmentId,
      before: { status: "ERROR" },
      after: { status: "EXTRACTING" },
    });

    revalidatePath(
      `/[locale]/admin/label-evaluator/${assessment.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}/${assessmentId}`,
      "page",
    );
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "RETRY_FAILED" };
  }
}

/** Lightweight poll target for the extraction-status UI (design doc §9). */
export async function getLabelAssessmentStatus(
  assessmentId: string,
): Promise<{ status: string } | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const row = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: { status: true },
    });
    return row ? { status: row.status } : null;
  } catch {
    return null;
  }
}

/**
 * Soft-claim check (design doc §13.4), called when a reviewer opens an
 * existing assessment. `claimAssessment` itself was already implemented but
 * never called from anywhere — confirmed live: two reviewers could open the
 * same in-progress item with no warning at all. This is the missing call
 * site; `force: true` is the reviewer's explicit take-over action.
 */
export async function checkAssessmentClaim(
  assessmentId: string,
  opts?: { force?: boolean },
): Promise<ActionResult<{ claimed: true } | { claimed: false; claimedByName: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    try {
      await claimAssessment(session, assessmentId, opts);
      return { ok: true, data: { claimed: true } };
    } catch (e) {
      if (e instanceof AlreadyClaimedError) {
        const claimer = await prisma.user.findUnique({
          where: { id: e.claimedByUserId },
          select: { fullNameEn: true },
        });
        return { ok: true, data: { claimed: false, claimedByName: claimer?.fullNameEn ?? "another reviewer" } };
      }
      throw e;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "CLAIM_FAILED" };
  }
}

const updateFieldSchema = z.object({
  assessmentId: z.string().min(1),
  fieldKey: z.string().min(1),
  valueEn: z.string().trim().max(5000).optional(),
  valueAr: z.string().trim().max(5000).optional(),
});

/**
 * Editing a field IS confirming it (design doc §1 Principle 3 / the live
 * cosmetics tool's "reviewer may correct any error before assessment begins"
 * pattern) — every save sets confirmedByUserId/confirmedAt, and the rule
 * engine (run-sfda.ts) reads only rows with a non-null confirmedAt.
 */
export async function updateExtractedField(
  input: z.infer<typeof updateFieldSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = updateFieldSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: parsed.data.assessmentId },
      select: { id: true, status: true, domain: true, method: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.status !== "AWAITING_REVIEW") {
      return { ok: false, error: "INVALID_STATE" };
    }

    const existing = await prisma.labelExtractedField.findUnique({
      where: { assessmentId_fieldKey: { assessmentId: parsed.data.assessmentId, fieldKey: parsed.data.fieldKey } },
      select: { valueEn: true, valueAr: true, originalMachineValue: true, confirmedAt: true },
    });

    await prisma.labelExtractedField.update({
      where: { assessmentId_fieldKey: { assessmentId: parsed.data.assessmentId, fieldKey: parsed.data.fieldKey } },
      data: {
        valueEn: parsed.data.valueEn,
        valueAr: parsed.data.valueAr,
        confirmedByUserId: session.id,
        confirmedAt: new Date(),
        // Preserve the pre-edit machine value on first confirm only (audit trail — design doc §3).
        originalMachineValue:
          existing && !existing.confirmedAt
            ? { valueEn: existing.valueEn, valueAr: existing.valueAr }
            : undefined,
      },
    });

    if (existing && (existing.valueEn !== parsed.data.valueEn || existing.valueAr !== parsed.data.valueAr)) {
      await writeAuditLog({
        session,
        action: "label_eval.field.update",
        entityType: "LabelExtractedField",
        entityId: `${parsed.data.assessmentId}:${parsed.data.fieldKey}`,
        before: { valueEn: existing.valueEn, valueAr: existing.valueAr },
        after: { valueEn: parsed.data.valueEn, valueAr: parsed.data.valueAr },
      });
    }

    // Was hardcoded to the sfda route, so editing a field on a cosmetics
    // assessment revalidated a page that does not exist and left the real one
    // stale. workspacePath is the single source of truth for this.
    revalidatePath(workspacePath(assessment.method, assessment.domain, parsed.data.assessmentId), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}

/**
 * The verification gate (design doc §1 Principle 3): blocked until every
 * mandatory field has a confirmed, non-empty value. Runs the rule engine and
 * flips the assessment to ASSESSED on success.
 */
export async function confirmFieldsAndRunAssessment(
  assessmentId: string,
): Promise<ActionResult<{ missingFields: string[] } | undefined>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        domain: true,
        method: true,
        status: true,
        requestItemId: true,
        documentsFingerprint: true,
        fields: { select: { fieldKey: true, valueEn: true, valueAr: true, confirmedAt: true } },
      },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.status !== "AWAITING_REVIEW") return { ok: false, error: "INVALID_STATE" };

    // Race condition guard (design doc §13.5): if the client replaced the
    // artwork/ingredient list after extraction ran, the confirmed fields
    // below were read from a now-superseded file. Block rather than let the
    // reviewer unknowingly confirm and score stale data — confirmed live
    // this was previously not checked at all. Only re-checked when the item
    // is still linked; an unlinked item (client hard-deleted the draft cart
    // row) has no live document to compare against, so the evaluator's own
    // copy stays the source of truth as designed (§3).
    if (assessment.requestItemId) {
      const liveFingerprint = await computeLiveFingerprint(assessment.requestItemId, assessment.domain);
      if (liveFingerprint && liveFingerprint !== assessment.documentsFingerprint) {
        return { ok: false, error: "DOCUMENTS_CHANGED" };
      }
    }

    const byKey = new Map(assessment.fields.map((f) => [f.fieldKey, f]));
    const missing = mandatoryFieldKeys(assessment.domain).filter((def) => {
      const f = byKey.get(def.key);
      return !f?.confirmedAt || !(f.valueEn?.trim() || f.valueAr?.trim());
    });
    if (missing.length > 0) {
      return { ok: false, error: `MISSING_FIELDS:${missing.map((m) => m.key).join(",")}` };
    }

    await prisma.labelAssessment.update({
      where: { id: assessmentId },
      data: { confirmedAt: new Date(), confirmedByUserId: session.id },
    });

    // The rule-engine call below is the only point where this action leaves
    // the assessment in a status it cannot re-enter on its own: the guard at
    // the top admits AWAITING_REVIEW only, and every in-flight status
    // (IN_FLIGHT_STATUSES, concurrency.ts) also blocks starting a fresh run.
    // A throw partway through therefore used to strand the item with no
    // route back — no retry, no reset, a manual DB update the only way out.
    // Restoring AWAITING_REVIEW keeps the action re-runnable and preserves
    // the reviewer's confirmed field values, which a fresh run would discard.
    // A crash that kills the process skips this handler entirely;
    // reclaimStalledAssessments (recovery.ts) is the backstop for that.
    try {
      if (assessment.domain === "SFDA_SUPPLEMENTS") {
        // No claim needed: run-sfda only ever upserts verdicts keyed on
        // @@unique([assessmentId, kbRuleId]) and rebuilds nothing, so two
        // overlapping runs converge on the same rows. Wasteful, not unsafe.
        await runSfdaRuleEngine(assessmentId);
        await prisma.labelAssessment.update({ where: { id: assessmentId }, data: { status: "ASSESSED" } });
      } else {
        // Claim the transition instead of assuming it. `assessment.status`
        // was read at the top of this action, so two reviewers clicking
        // together — or a reviewer racing the reclaim sweep on a long run —
        // could both pass that check and enter the engine at once. That
        // matters here specifically because run-cosmetics rebuilds
        // LabelRequiredTest with deleteMany + createMany and that table has
        // no unique constraint, so an overlap would silently duplicate every
        // required test rather than erroring. `updateMany` with the expected
        // status is the same guard concurrency.ts uses for verdict overrides
        // and admin/actions.ts uses for request-state transitions.
        const claimed = await prisma.labelAssessment.updateMany({
          where: { id: assessmentId, status: "AWAITING_REVIEW" },
          data: { status: "CLASSIFYING" },
        });
        // Lost the race — the run that won owns the assessment now. Return
        // without resetting anything, so the winner is left undisturbed.
        if (claimed.count === 0) return { ok: false, error: "INVALID_STATE" };
        await runCosmeticsRuleEngine(assessmentId);
        // run-cosmetics.ts itself sets the final status (ASSESSED or
        // BLOCKED_NO_CATEGORY_MATCH) — never overwritten here.
      }
    } catch (error) {
      log.error("label-eval.assessment", "rule engine failed — returning assessment to AWAITING_REVIEW", {
        assessmentId,
        domain: assessment.domain,
        error: error instanceof Error ? error.message : "unknown",
      });
      try {
        await prisma.labelAssessment.update({
          where: { id: assessmentId },
          data: { status: "AWAITING_REVIEW" },
        });
      } catch (resetError) {
        // Losing the reset leaves the row stalled until the recovery sweep
        // picks it up; surface it so that delay is explainable.
        log.error("label-eval.assessment", "could not restore AWAITING_REVIEW after a failed run", {
          assessmentId,
          error: resetError instanceof Error ? resetError.message : "unknown",
        });
      }
      return { ok: false, error: "RUN_FAILED" };
    }

    await writeAuditLog({
      session,
      action: "label_eval.assessment.confirm_and_run",
      entityType: "LabelAssessment",
      entityId: assessmentId,
    });

    revalidatePath(workspacePath(assessment.method, assessment.domain, assessmentId), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "RUN_FAILED" };
  }
}

const overrideSchema = z.object({
  assessmentId: z.string().min(1),
  kbRuleId: z.string().min(1),
  expectedPreviousVerdict: z.enum(["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA", "MISSING"]),
  newVerdict: z.enum(["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA", "MISSING"]),
  rationale: z.string().trim().max(1000).optional(),
});

export async function overrideItemVerdict(
  input: z.infer<typeof overrideSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = overrideSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: parsed.data.assessmentId },
      select: { domain: true, method: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };

    // Workflow doc §12: "Any modification requires: ...Reason." SFDA has no
    // equivalent documented requirement, so this stays cosmetics-only rather
    // than tightening a working SFDA flow with no directive to change it.
    if (assessment.domain === "COSMETICS" && !parsed.data.rationale?.trim()) {
      return { ok: false, error: "RATIONALE_REQUIRED" };
    }

    await applyVerdictOverride(session, parsed.data);

    // The summary/final-verdict bar reads LabelAssessment.overallRate/
    // finalVerdict, which the rule engine only sets at run time — without
    // this, an override silently leaves the displayed score disagreeing
    // with the per-item verdicts it was just computed from (confirmed live).
    if (assessment.domain === "SFDA_SUPPLEMENTS") {
      await recomputeSfdaScore(parsed.data.assessmentId);
    } else {
      await recomputeCosmeticsScore(parsed.data.assessmentId);
    }

    revalidatePath(workspacePath(assessment.method, assessment.domain, parsed.data.assessmentId), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof VerdictConflictError) return { ok: false, error: "CONFLICT" };
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "OVERRIDE_FAILED" };
  }
}

const confirmProposedSchema = z.object({
  assessmentId: z.string().min(1),
  kbRuleId: z.string().min(1),
});

/**
 * Explicit human confirmation of an LLM-proposed judgment verdict (design
 * doc §1 Principle 2) — the reviewer read the AI's proposed verdict and
 * agrees with it as-is. Distinct from overrideItemVerdict, which records a
 * *changed* value: this records that a human looked at an *unchanged* AI
 * proposal and accepted it. Flips autoOrManual from "llm_proposed" to
 * "llm_confirmed", which is what isPromotableVerdict (promotion-eligibility.ts)
 * checks before planPromotion will include the item — without this action
 * (or an override), an LLM-proposed verdict can never reach the official
 * checklist. Guarded the same way as applyVerdictOverride: `updateMany`
 * against the expected "llm_proposed" state so a concurrent confirm/override
 * from another reviewer can't silently race.
 */
export async function confirmProposedVerdict(
  input: z.infer<typeof confirmProposedSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = confirmProposedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: parsed.data.assessmentId },
      select: { domain: true, method: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };

    const result = await prisma.labelItemVerdict.updateMany({
      where: {
        assessmentId: parsed.data.assessmentId,
        kbRuleId: parsed.data.kbRuleId,
        autoOrManual: "llm_proposed",
      },
      data: {
        autoOrManual: "llm_confirmed",
        overriddenByUserId: session.id,
        overriddenAt: new Date(),
      },
    });
    if (result.count === 0) return { ok: false, error: "CONFLICT" };

    await writeAuditLog({
      session,
      action: "label_eval.verdict.confirm_proposed",
      entityType: "LabelItemVerdict",
      entityId: `${parsed.data.assessmentId}:${parsed.data.kbRuleId}`,
    });

    revalidatePath(workspacePath(assessment.method, assessment.domain, parsed.data.assessmentId), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "CONFIRM_FAILED" };
  }
}

/**
 * Fetches the assessment's verdicts plus the linked RequestItem's official
 * checklist codes, shared by previewPromotion (dry run) and
 * promoteToOfficialChecklist (the real write) so the two can never disagree
 * about what promoting would do.
 */
async function planPromotion(assessmentId: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      domain: LabelEvalDomain;
      requestItemId: string;
      verdicts: Record<string, "COMPLIANT" | "NON_COMPLIANT" | "NA">;
      withheld: number;
      droppedCodes: string[];
      priorDataExists: boolean;
      /** Frozen-at-promotion-time record for LabelReport.snapshot — see promoteToOfficialChecklist. */
      snapshot: {
        kbVersionId: string;
        finalVerdict: string | null;
        overallRate: number | null;
        classification: {
          detectedCategoryCode: string | null;
          overrideCategoryCode: string | null;
          rationale: string | null;
        } | null;
        fields: Array<{ fieldKey: string; valueEn: string | null; valueAr: string | null }>;
        verdicts: Array<{
          ruleCode: string;
          verdict: string;
          autoOrManual: string;
          evidenceText: string | null;
          rationale: string | null;
        }>;
      };
    }
> {
  const assessment = await prisma.labelAssessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      status: true,
      domain: true,
      requestItemId: true,
      kbVersionId: true,
      finalVerdict: true,
      overallRate: true,
      classification: {
        select: { detectedCategoryCode: true, overrideCategoryCode: true, rationale: true },
      },
      fields: {
        where: { confirmedAt: { not: null } },
        select: { fieldKey: true, valueEn: true, valueAr: true },
      },
      verdicts: { include: { kbRule: { select: { code: true } } } },
    },
  });
  if (!assessment) return { ok: false, error: "NOT_FOUND" };
  if (assessment.status !== "ASSESSED") return { ok: false, error: "INVALID_STATE" };
  if (!assessment.requestItemId) return { ok: false, error: "REQUEST_ITEM_UNLINKED" };

  const item = await prisma.requestItem.findUnique({
    where: { id: assessment.requestItemId },
    select: { assessment: true, serviceItem: { select: { checkSets: true } } },
  });
  if (!item) return { ok: false, error: "NOT_FOUND" };

  // §13.3 constraint #2: saveAssessment silently drops verdicts whose codes
  // aren't in the service's official checklist. Check alignment ourselves
  // BEFORE calling it (same code set it uses internally), so a drift — e.g.
  // a future KB re-upload using different codes — blocks promotion instead
  // of silently under-writing the checklist with no visible signal.
  const checkSets = parseCheckSets(item.serviceItem.checkSets);
  const knownCodes = new Set(checkSets.flatMap((s) => s.items.map((i) => i.code)));

  const verdicts: Record<string, "COMPLIANT" | "NON_COMPLIANT" | "NA"> = {};
  const droppedCodes: string[] = [];
  let withheld = 0;
  for (const v of assessment.verdicts) {
    // isPromotableVerdict (design doc §1 Principle 2) refuses an
    // LLM-proposed verdict nobody has confirmed yet — it is withheld exactly
    // like an unresolved NEEDS_REVIEW/REQUIRES_ADDITIONAL_DATA item, never
    // silently treated as a human-confirmed pass/fail.
    if (isPromotableVerdict(v.verdict, v.autoOrManual)) {
      if (knownCodes.has(v.kbRule.code)) verdicts[v.kbRule.code] = v.verdict;
      else droppedCodes.push(v.kbRule.code);
    } else {
      withheld++;
    }
  }

  const priorState = parseAssessment(item.assessment);
  const priorDataExists = Object.keys(priorState.verdicts ?? {}).length > 0;

  const snapshot = {
    kbVersionId: assessment.kbVersionId,
    finalVerdict: assessment.finalVerdict,
    overallRate: assessment.overallRate,
    classification: assessment.classification,
    fields: assessment.fields,
    verdicts: assessment.verdicts.map((v) => ({
      ruleCode: v.kbRule.code,
      verdict: v.verdict,
      autoOrManual: v.autoOrManual,
      evidenceText: v.evidenceText,
      rationale: v.rationale,
    })),
  };

  return {
    ok: true,
    domain: assessment.domain,
    requestItemId: assessment.requestItemId,
    verdicts,
    withheld,
    droppedCodes,
    priorDataExists,
    snapshot,
  };
}

/**
 * Dry-run for the promotion confirmation dialog (design doc §13.3: "shows a
 * pre-flight summary before writing... The reviewer confirms explicitly.")
 * — computes exactly what promoteToOfficialChecklist would do without
 * writing anything.
 */
export async function previewPromotion(
  assessmentId: string,
): Promise<ActionResult<{ written: number; withheld: number; wouldDrop: number; priorDataExists: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const plan = await planPromotion(assessmentId);
    if (!plan.ok) return plan;

    return {
      ok: true,
      data: {
        written: Object.keys(plan.verdicts).length,
        withheld: plan.withheld,
        wouldDrop: plan.droppedCodes.length,
        priorDataExists: plan.priorDataExists,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "PROMOTE_FAILED" };
  }
}

/**
 * Promotion bridge (design doc §13.3) — the ONLY point of contact with the
 * existing lifecycle. Calls the existing, unmodified `saveAssessment`
 * (src/server/admin/actions.ts) so promotion inherits its own
 * `requests:admin` gate, ASSESSMENT_EDIT_STATES window, and audit trail.
 * NEEDS_REVIEW/REQUIRES_ADDITIONAL_DATA verdicts are omitted, never coerced
 * — saveAssessment only accepts COMPLIANT/NON_COMPLIANT/NA, and coercing an
 * unresolved item into a pass or fail would falsify a compliance record.
 */
export async function promoteToOfficialChecklist(
  assessmentId: string,
): Promise<ActionResult<{ written: number; withheld: number; recommendation: string; complete: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const plan = await planPromotion(assessmentId);
    if (!plan.ok) return plan;
    // Refuse rather than silently under-write (§13.3 constraint #2).
    if (plan.droppedCodes.length > 0) return { ok: false, error: `CODE_MISMATCH:${plan.droppedCodes.join(",")}` };

    const { domain, requestItemId, verdicts, withheld, snapshot } = plan;
    const result = await saveAssessment({ requestItemId, verdicts });
    if (!result.ok) return result;

    // snapshot freezes fields + verdicts + classification + kbVersion as of
    // the moment promotion happened (schema's own documented contract for
    // this column) — built by planPromotion from the exact same read that
    // determined what got promoted, so it can never disagree with the
    // checklist it's a record of. Re-written on every promotion (including a
    // re-promotion after a resubmission) so it always reflects the latest.
    await prisma.labelReport.upsert({
      where: { assessmentId },
      create: {
        assessmentId,
        snapshot,
        promotedAt: new Date(),
        promotedByUserId: session.id,
      },
      update: { snapshot, promotedAt: new Date(), promotedByUserId: session.id },
    });

    await writeAuditLog({
      session,
      action: "label_eval.assessment.promote",
      entityType: "LabelAssessment",
      entityId: assessmentId,
      after: { written: Object.keys(verdicts).length, withheld },
    });

    const basePath = domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";
    revalidatePath(`/[locale]/admin/label-evaluator/${basePath}/${assessmentId}`, "page");
    revalidatePath(`/[locale]/admin/requests/${requestItemId}`, "page");

    return {
      ok: true,
      data: { written: Object.keys(verdicts).length, withheld, ...result.data },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "PROMOTE_FAILED" };
  }
}

const reclassifySchema = z.object({
  assessmentId: z.string().min(1),
  categoryCode: z.string().min(1),
});

/**
 * Manual category override (design doc §1 Principle 4 / §9 "Reclassify").
 * Logged — an override away from "no confident match" is a meaningful
 * regulatory judgment call, not a routine edit. Re-runs the full rule
 * engine afterward since classification drives claims/tests/label checks.
 */
export async function reclassifyAssessment(
  input: z.infer<typeof reclassifySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = reclassifySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: parsed.data.assessmentId },
      select: { id: true, domain: true, method: true, status: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.domain !== "COSMETICS") return { ok: false, error: "WRONG_DOMAIN" };
    // Re-running the rule engine on a manual assessment would overwrite every
    // hand-typed verdict on it. setManualCategory is the manual counterpart.
    if (assessment.method !== "AI") return { ok: false, error: "WRONG_METHOD" };
    if (assessment.status !== "ASSESSED" && assessment.status !== "BLOCKED_NO_CATEGORY_MATCH") {
      return { ok: false, error: "INVALID_STATE" };
    }

    await prisma.labelClassification.upsert({
      where: { assessmentId: parsed.data.assessmentId },
      create: {
        assessmentId: parsed.data.assessmentId,
        overrideCategoryCode: parsed.data.categoryCode,
        overriddenByUserId: session.id,
        overriddenAt: new Date(),
      },
      update: {
        overrideCategoryCode: parsed.data.categoryCode,
        overriddenByUserId: session.id,
        overriddenAt: new Date(),
      },
    });

    await writeAuditLog({
      session,
      action: "label_eval.classification.reclassify",
      entityType: "LabelAssessment",
      entityId: parsed.data.assessmentId,
      after: { categoryCode: parsed.data.categoryCode },
    });

    await runCosmeticsRuleEngine(parsed.data.assessmentId);

    revalidatePath(`/[locale]/admin/label-evaluator/cosmetics/${parsed.data.assessmentId}`, "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "RUN_FAILED" };
  }
}

// ─── Manual route ───────────────────────────────────────────────────────────

/**
 * The KB rules a run covers, per domain — the single definition the manual
 * route seeds its checklist from, kept identical to what each rule engine
 * evaluates so a manual run and an AI run cover exactly the same items.
 * SFDA evaluates every rule in the version (run-sfda.ts); cosmetics evaluates
 * the two item rule types and handles REQUIRED_TEST_RULEs separately
 * (run-cosmetics.ts).
 */
function checklistRuleFilter(domain: LabelEvalDomain): Prisma.LabelKbRuleWhereInput {
  return domain === "SFDA_SUPPLEMENTS"
    ? {}
    : { ruleType: { in: ["LABEL_REQUIREMENT_ITEM", "CLAIM_PHASE_ITEM"] } };
}

/**
 * Starts a MANUAL run: the same item, the same active KB, the same source
 * documents copied into evaluator storage — but no extraction job, no
 * classifier and no rule engine. Every rule in the checklist is seeded
 * NEEDS_REVIEW so the evaluator's own verdicts are the only thing that can
 * ever resolve one.
 *
 * `autoOrManual: "manual_pending"` on the seeded rows is deliberately NOT
 * "manual_override": nobody has judged them yet, and NEEDS_REVIEW is
 * unpromotable by value anyway (promotion-eligibility.ts), so a half-finished
 * manual run can never leak an unjudged verdict into the official checklist.
 * Setting a verdict goes through overrideItemVerdict like any other human
 * judgment, which stamps "manual_override" and the reviewer's id.
 */
export async function startManualLabelAssessment(
  input: z.infer<typeof startAssessmentSchema>,
): Promise<ActionResult<{ assessmentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = startAssessmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, domain } = parsed.data;

    let evaluable: Awaited<ReturnType<typeof assertRequestItemEvaluable>>;
    try {
      evaluable = await assertRequestItemEvaluable(requestItemId, domain);
    } catch (e) {
      if (e instanceof EvaluationUnavailableError) {
        return { ok: false, error: `NOT_EVALUABLE:${e.currentState}` };
      }
      if (e instanceof Error && e.message === "WRONG_DOMAIN") {
        return { ok: false, error: "WRONG_DOMAIN" };
      }
      return { ok: false, error: "NOT_FOUND" };
    }

    try {
      await assertNoInFlightRun(requestItemId);
    } catch (e) {
      if (e instanceof InFlightRunExistsError) {
        return { ok: false, error: `IN_FLIGHT:${e.existingAssessmentId}:${e.existingMethod}` };
      }
      throw e;
    }

    const activeKb = await prisma.labelKbVersion.findFirst({
      where: { domain, status: "ACTIVE" },
      orderBy: { activatedAt: "desc" },
    });
    if (!activeKb) return { ok: false, error: "NO_ACTIVE_DATASET" };

    const rules = await prisma.labelKbRule.findMany({
      where: { kbVersionId: activeKb.id, ...checklistRuleFilter(domain) },
      select: { id: true },
    });
    if (rules.length === 0) return { ok: false, error: "NO_ACTIVE_DATASET" };

    const item = await prisma.requestItem.findUniqueOrThrow({
      where: { id: evaluable.requestItemId },
      select: {
        request: {
          select: { requestNo: true, organisation: { select: { id: true, nameEn: true } } },
        },
        serviceItem: { select: { code: true } },
      },
    });

    // Same ingest as the AI route, for two reasons: the evaluator needs the
    // artwork in front of them to judge anything, and documentsFingerprint —
    // which drives the "needs (re-)evaluation" queue check — is computed from
    // exactly these files. A manual run that skipped it would leave the item
    // sitting in the queue forever.
    let ingested: Awaited<ReturnType<typeof ingestRequestItemDocuments>>;
    try {
      ingested = await ingestRequestItemDocuments(
        requestItemId,
        DOCUMENT_KIND_BY_REQUIRED_CODE[domain],
      );
    } catch {
      return { ok: false, error: "SOURCE_DOCUMENT_UNREADABLE" };
    }
    if (ingested.length === 0) return { ok: false, error: "NO_DOCUMENTS" };

    const fingerprint = computeDocumentsFingerprint(ingested.map((d) => d.sha256));

    const assessment = await prisma.$transaction(async (tx) => {
      const created = await tx.labelAssessment.create({
        data: {
          domain,
          method: "MANUAL",
          status: "MANUAL_IN_PROGRESS",
          kbVersionId: activeKb.id,
          requestItemId: evaluable.requestItemId,
          requestNo: item.request.requestNo,
          organisationId: item.request.organisation.id,
          organisationName: item.request.organisation.nameEn,
          serviceItemCode: item.serviceItem.code,
          documentsFingerprint: fingerprint,
          createdByUserId: session.id,
          claimedByUserId: session.id,
          claimedAt: new Date(),
        },
      });
      await tx.labelDocument.createMany({
        data: ingested.map((d) => ({
          assessmentId: created.id,
          kind: d.kind,
          sourceDocumentVersionId: d.sourceDocumentVersionId,
          fileName: d.fileName,
          mimeType: d.mimeType,
          sizeBytes: d.sizeBytes,
          storageKey: d.storageKey,
          sha256: d.sha256,
        })),
      });
      await tx.labelItemVerdict.createMany({
        data: rules.map((r) => ({
          assessmentId: created.id,
          kbRuleId: r.id,
          verdict: "NEEDS_REVIEW" as const,
          autoOrManual: "manual_pending",
        })),
      });
      // Record the route on the item too, so the request page and the queue
      // agree with what actually happened even if nobody chose beforehand.
      await tx.requestItem.update({
        where: { id: evaluable.requestItemId },
        data: { assessmentMethod: "MANUAL" },
      });
      return created;
    });

    await writeAuditLog({
      session,
      action: "label_eval.assessment.start_manual",
      entityType: "LabelAssessment",
      entityId: assessment.id,
      organisationId: item.request.organisation.id,
      after: { domain, requestItemId, kbVersionId: activeKb.id, method: "MANUAL" },
    });

    revalidatePath(
      `/[locale]/admin/label-evaluator/${domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}`,
      "page",
    );
    return { ok: true, data: { assessmentId: assessment.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "START_FAILED" };
  }
}

const manualCategorySchema = z.object({
  assessmentId: z.string().min(1),
  categoryCode: z.string().min(1),
});

/**
 * Cosmetics manual runs: the evaluator states the product category
 * themselves. Deliberately NOT `reclassifyAssessment` — that action re-runs
 * the whole cosmetics rule engine (classifier + LLM judgments), which would
 * overwrite every hand-typed verdict on this assessment. This writes the
 * category and re-derives only the deterministic required-tests table from it.
 */
export async function setManualCategory(
  input: z.infer<typeof manualCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = manualCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: parsed.data.assessmentId },
      select: { id: true, domain: true, method: true, status: true, kbVersionId: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.domain !== "COSMETICS") return { ok: false, error: "WRONG_DOMAIN" };
    if (assessment.method !== "MANUAL") return { ok: false, error: "WRONG_METHOD" };
    // ASSESSED is admitted as well as MANUAL_IN_PROGRESS. The category drives
    // applyRequiredTests, so a wrong one bakes a wrong required-tests table
    // into a run that then gets promoted — and starting a fresh run is no
    // escape, because listNeedsEvaluation filters the item out once an
    // ASSESSED run exists for the same fingerprint. The AI route has
    // reclassifyAssessment for exactly this case; without this the manual
    // route had no way back at all.
    if (assessment.status !== "MANUAL_IN_PROGRESS" && assessment.status !== "ASSESSED") {
      return { ok: false, error: "INVALID_STATE" };
    }

    const category = await prisma.labelKbCategory.findUnique({
      where: { kbVersionId_code: { kbVersionId: assessment.kbVersionId, code: parsed.data.categoryCode } },
      select: { code: true, properties: true },
    });
    if (!category) return { ok: false, error: "VALIDATION" };

    await prisma.labelClassification.upsert({
      where: { assessmentId: assessment.id },
      create: {
        assessmentId: assessment.id,
        overrideCategoryCode: category.code,
        overriddenByUserId: session.id,
        overriddenAt: new Date(),
      },
      update: {
        overrideCategoryCode: category.code,
        overriddenByUserId: session.id,
        overriddenAt: new Date(),
      },
    });

    await applyRequiredTests(assessment.id, assessment.kbVersionId, {
      categoryCode: category.code,
      properties: (category.properties as string[] | null) ?? [],
    });

    await writeAuditLog({
      session,
      action: "label_eval.classification.manual_set",
      entityType: "LabelAssessment",
      entityId: assessment.id,
      after: { categoryCode: category.code },
    });

    revalidatePath(workspacePath("MANUAL", assessment.domain, assessment.id), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const completeManualSchema = z.object({ assessmentId: z.string().min(1) });

/**
 * Closes a manual run: scores it with the same formula the corresponding rule
 * engine uses (recomputeSfdaScore / recomputeCosmeticsScore — never a second
 * scoring implementation) and moves it to ASSESSED, from which the existing
 * promote-to-official-checklist path works identically to an AI run.
 *
 * Refuses while any item is still unjudged. NEEDS_REVIEW / REQUIRES_ADDITIONAL_DATA
 * are unpromotable, so completing with them left over would produce a run that
 * silently drops items at promotion time; blocking here makes that visible
 * while the evaluator can still act on it.
 */
export async function completeManualAssessment(
  input: z.infer<typeof completeManualSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeManualSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { assessmentId } = parsed.data;

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        domain: true,
        method: true,
        status: true,
        requestItemId: true,
        documentsFingerprint: true,
        classification: { select: { overrideCategoryCode: true } },
      },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.method !== "MANUAL") return { ok: false, error: "WRONG_METHOD" };
    if (assessment.status !== "MANUAL_IN_PROGRESS") return { ok: false, error: "INVALID_STATE" };

    // Same race guard the AI route applies before scoring (design doc §13.5):
    // if the client replaced the artwork while the evaluator was working, the
    // verdicts below were judged against a superseded file.
    if (assessment.requestItemId) {
      const liveFingerprint = await computeLiveFingerprint(assessment.requestItemId, assessment.domain);
      if (liveFingerprint && liveFingerprint !== assessment.documentsFingerprint) {
        return { ok: false, error: "DOCUMENTS_CHANGED" };
      }
    }

    if (assessment.domain === "COSMETICS" && !assessment.classification?.overrideCategoryCode) {
      return { ok: false, error: "CATEGORY_REQUIRED" };
    }

    const unresolved = await prisma.labelItemVerdict.count({
      where: {
        assessmentId,
        verdict: { in: ["NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA"] },
      },
    });
    if (unresolved > 0) return { ok: false, error: `UNRESOLVED_ITEMS:${unresolved}` };

    // Score BEFORE the status flip, not after. Flipping first and then
    // recomputing leaves a window where a failed recompute strands the run:
    // the row is already ASSESSED with a stale/null finalVerdict, the retry
    // is refused by the MANUAL_IN_PROGRESS guard above, and the item has
    // already dropped out of the needs-evaluation queue. runCosmeticsRuleEngine
    // writes status and finalVerdict in one update for the same reason.
    // Scoring early is safe because it only reads verdicts and writes
    // finalVerdict — re-running it is idempotent.
    if (assessment.domain === "SFDA_SUPPLEMENTS") {
      await recomputeSfdaScore(assessmentId);
    } else {
      await recomputeCosmeticsScore(assessmentId);
    }

    // Claim the transition rather than trusting the status read above, the
    // same guard confirmFieldsAndRunAssessment uses — two evaluators on one
    // assessment must not both complete it.
    const claimed = await prisma.labelAssessment.updateMany({
      where: { id: assessmentId, status: "MANUAL_IN_PROGRESS" },
      data: { status: "ASSESSED", confirmedAt: new Date(), confirmedByUserId: session.id },
    });
    if (claimed.count === 0) return { ok: false, error: "INVALID_STATE" };

    await writeAuditLog({
      session,
      action: "label_eval.assessment.complete_manual",
      entityType: "LabelAssessment",
      entityId: assessmentId,
    });

    revalidatePath(workspacePath("MANUAL", assessment.domain, assessmentId), "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const abandonManualSchema = z.object({ assessmentId: z.string().min(1) });

/**
 * Discards a manual run that should never have been started.
 *
 * Without this, one mis-click on the queue's "Manual evaluation" button was
 * unrecoverable: MANUAL_IN_PROGRESS is an in-flight status, so
 * assertNoInFlightRun bounces every subsequent "AI evaluation" click back
 * into the manual run, setItemAssessmentMethod refuses to switch
 * (RUN_IN_FLIGHT), and the stall sweep is deliberately told to leave manual
 * runs alone (recovery.ts) because they legitimately sit for days. The only
 * other exit was hand-judging every seeded rule — 113 for SFDA, and for
 * cosmetics each one also demanding a typed rationale. The AI route has
 * retryExtraction and the stall sweep as escapes; this is the manual
 * equivalent.
 *
 * Deletes rather than parks in a dead status: the row carries no human
 * judgment worth keeping (that is what the guard below enforces), and a
 * lingering non-terminal row would keep tripping the in-flight check. The
 * cascade takes the seeded verdicts and the copied documents with it. The
 * audit log records that it happened.
 */
export async function abandonManualAssessment(
  input: z.infer<typeof abandonManualSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = abandonManualSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { assessmentId } = parsed.data;

    const assessment = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        domain: true,
        method: true,
        status: true,
        requestItemId: true,
        organisationId: true,
        requestNo: true,
      },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.method !== "MANUAL") return { ok: false, error: "WRONG_METHOD" };
    if (assessment.status !== "MANUAL_IN_PROGRESS") return { ok: false, error: "INVALID_STATE" };

    // Refuse once real work exists. Seeded rows are NEEDS_REVIEW /
    // "manual_pending"; anything else means a human judged an item, and
    // throwing that away silently is not this action's job — finish the run
    // or change the verdicts back.
    const judged = await prisma.labelItemVerdict.count({
      where: { assessmentId, autoOrManual: { not: "manual_pending" } },
    });
    if (judged > 0) return { ok: false, error: `HAS_JUDGEMENTS:${judged}` };

    await prisma.$transaction(async (tx) => {
      await tx.labelAssessment.delete({ where: { id: assessmentId } });
      // Clear the route stamp this run wrote, so the queue stops presenting
      // MANUAL as the chosen method for an item that has no manual run.
      if (assessment.requestItemId) {
        await tx.requestItem.updateMany({
          where: { id: assessment.requestItemId, assessmentMethod: "MANUAL" },
          data: { assessmentMethod: null },
        });
      }
    });

    await writeAuditLog({
      session,
      action: "label_eval.assessment.abandon_manual",
      entityType: "LabelAssessment",
      entityId: assessmentId,
      organisationId: assessment.organisationId,
      before: { requestNo: assessment.requestNo, status: "MANUAL_IN_PROGRESS" },
    });

    revalidatePath(
      `/[locale]/admin/label-evaluator/${assessment.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}`,
      "page",
    );
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}
