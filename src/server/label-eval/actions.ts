"use server";

import type { LabelEvalDomain } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
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
import { runCosmeticsRuleEngine, recomputeCosmeticsScore } from "@/server/label-eval/evaluators/run-cosmetics";
import { saveAssessment } from "@/server/admin/actions";
import { parseAssessment, parseCheckSets } from "@/lib/assessment";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
        return { ok: false, error: `IN_FLIGHT:${e.existingAssessmentId}` };
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
      select: { id: true, status: true },
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

    revalidatePath(`/[locale]/admin/label-evaluator/sfda/${parsed.data.assessmentId}`, "page");
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

    if (assessment.domain === "SFDA_SUPPLEMENTS") {
      await runSfdaRuleEngine(assessmentId);
      await prisma.labelAssessment.update({ where: { id: assessmentId }, data: { status: "ASSESSED" } });
    } else {
      await prisma.labelAssessment.update({ where: { id: assessmentId }, data: { status: "CLASSIFYING" } });
      await runCosmeticsRuleEngine(assessmentId);
      // run-cosmetics.ts itself sets the final status (ASSESSED or
      // BLOCKED_NO_CATEGORY_MATCH) — never overwritten here.
    }

    await writeAuditLog({
      session,
      action: "label_eval.assessment.confirm_and_run",
      entityType: "LabelAssessment",
      entityId: assessmentId,
    });

    const basePath = assessment.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";
    revalidatePath(`/[locale]/admin/label-evaluator/${basePath}/${assessmentId}`, "page");
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
  expectedPreviousVerdict: z.enum(["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA"]),
  newVerdict: z.enum(["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA"]),
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
      select: { domain: true },
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

    const basePath = assessment.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";
    revalidatePath(`/[locale]/admin/label-evaluator/${basePath}/${parsed.data.assessmentId}`, "page");
    return { ok: true, data: undefined };
  } catch (error) {
    if (error instanceof VerdictConflictError) return { ok: false, error: "CONFLICT" };
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "OVERRIDE_FAILED" };
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
    }
> {
  const assessment = await prisma.labelAssessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      status: true,
      domain: true,
      requestItemId: true,
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
    if (v.verdict === "COMPLIANT" || v.verdict === "NON_COMPLIANT" || v.verdict === "NA") {
      if (knownCodes.has(v.kbRule.code)) verdicts[v.kbRule.code] = v.verdict;
      else droppedCodes.push(v.kbRule.code);
    } else {
      withheld++;
    }
  }

  const priorState = parseAssessment(item.assessment);
  const priorDataExists = Object.keys(priorState.verdicts ?? {}).length > 0;

  return { ok: true, domain: assessment.domain, requestItemId: assessment.requestItemId, verdicts, withheld, droppedCodes, priorDataExists };
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

    const { domain, requestItemId, verdicts, withheld } = plan;
    const result = await saveAssessment({ requestItemId, verdicts });
    if (!result.ok) return result;

    await prisma.labelReport.upsert({
      where: { assessmentId },
      create: { assessmentId, snapshot: {}, promotedAt: new Date(), promotedByUserId: session.id },
      update: { promotedAt: new Date(), promotedByUserId: session.id },
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
      select: { id: true, domain: true, status: true },
    });
    if (!assessment) return { ok: false, error: "NOT_FOUND" };
    if (assessment.domain !== "COSMETICS") return { ok: false, error: "WRONG_DOMAIN" };
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
