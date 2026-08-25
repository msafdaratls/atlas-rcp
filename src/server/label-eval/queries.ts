import type { LabelAssessmentStatus, LabelEvalDomain, LabelKbStatus, RequestState } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { computeDocumentsFingerprint } from "@/server/label-eval/fingerprint";
import { DOCUMENT_KIND_BY_REQUIRED_CODE } from "@/server/label-eval/fields";

/**
 * "Needs Evaluation" queue (design doc §2A). Read-only against
 * Request/RequestItem/RequestDocument/DocumentVersion — this file must never
 * write to those tables or call any existing request-lifecycle action.
 *
 * Reuses the existing `requests:admin` permission rather than introducing a
 * new one: REQUESTS_ADMIN_ROLES (src/lib/rbac.ts) already covers exactly the
 * roles the design doc calls for (EVALUATOR, TECHNICAL_REVIEWER, SYSTEM_ADMIN,
 * QUALITY_MANAGER), so a separate `label_eval:read` permission would only add
 * unused surface to rbac.ts. Matches the "minimal footprint" principle this
 * feature is held to (design doc §13.2).
 */

export type NeedsEvaluationRow = {
  requestItemId: string;
  requestId: string;
  requestNo: string;
  productNameEn: string;
  productNameAr: string;
  serviceCode: string;
  serviceNameEn: string;
  serviceNameAr: string;
  organisationId: string;
  organisationNameEn: string;
  organisationNameAr: string;
  slaDueAt: string | null;
  /** Display-only badge (design doc §2A.1) — NOT used for filtering. */
  isResubmission: boolean;
  /** Stamped onto the LabelAssessment this run creates. */
  documentsFingerprint: string;
};

/** The only real "ready for a human to act" resting state (design doc §0.3). */
const EVALUATION_READY_STATE: RequestState = "ASSESSMENT_RUNNING";

export async function listNeedsEvaluation(
  domain: LabelEvalDomain,
  opts?: { assignedToMeOnly?: boolean },
): Promise<NeedsEvaluationRow[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const mappings = await prisma.labelEvalServiceMapping.findMany({
      where: { domain },
      select: { serviceItemId: true },
    });
    const serviceItemIds = mappings.map((m) => m.serviceItemId);
    if (serviceItemIds.length === 0) return [];

    const items = await prisma.requestItem.findMany({
      where: {
        serviceItemId: { in: serviceItemIds },
        request: {
          state: EVALUATION_READY_STATE,
          ...(opts?.assignedToMeOnly ? { assignedToUserId: session.id } : {}),
        },
      },
      select: {
        id: true,
        productNameEn: true,
        productNameAr: true,
        serviceItem: { select: { code: true, nameEn: true, nameAr: true } },
        request: {
          select: {
            id: true,
            requestNo: true,
            submissionNo: true,
            slaDueAt: true,
            organisation: { select: { id: true, nameEn: true, nameAr: true } },
          },
        },
        documents: {
          select: {
            requiredDocument: { select: { code: true } },
            currentVersion: { select: { sha256: true } },
          },
        },
      },
    });

    // Fingerprint each item from exactly the documents this evaluator
    // ingests (DOCUMENT_KIND_BY_REQUIRED_CODE — artwork + ingredient list),
    // NOT every mandatory document on the service item. SFDA's Certificate
    // of Analysis and Claims-substantiation dossier are mandatory for the
    // request but are not label artwork; a client replacing those must not
    // force label re-evaluation. An item whose in-scope documents resolve to
    // zero hashes (e.g. a document not yet versioned) is excluded rather
    // than shown with a misleading/empty fingerprint.
    const inScopeCodes = new Set(Object.keys(DOCUMENT_KIND_BY_REQUIRED_CODE[domain]));
    const candidates: { item: (typeof items)[number]; fingerprint: string }[] = [];
    for (const item of items) {
      const hashes = item.documents
        .filter((d) => d.requiredDocument && inScopeCodes.has(d.requiredDocument.code) && d.currentVersion?.sha256)
        .map((d) => d.currentVersion!.sha256);
      if (hashes.length === 0) continue;
      candidates.push({ item, fingerprint: computeDocumentsFingerprint(hashes) });
    }
    if (candidates.length === 0) return [];

    const assessed = await prisma.labelAssessment.findMany({
      where: {
        requestItemId: { in: candidates.map((c) => c.item.id) },
        status: "ASSESSED",
      },
      select: { requestItemId: true, documentsFingerprint: true },
    });
    const alreadyAssessed = new Set(
      assessed.map((a) => `${a.requestItemId}::${a.documentsFingerprint}`),
    );

    const rows: NeedsEvaluationRow[] = candidates
      .filter((c) => !alreadyAssessed.has(`${c.item.id}::${c.fingerprint}`))
      .map((c) => ({
        requestItemId: c.item.id,
        requestId: c.item.request.id,
        requestNo: c.item.request.requestNo,
        productNameEn: c.item.productNameEn,
        productNameAr: c.item.productNameAr,
        serviceCode: c.item.serviceItem.code,
        serviceNameEn: c.item.serviceItem.nameEn,
        serviceNameAr: c.item.serviceItem.nameAr,
        organisationId: c.item.request.organisation.id,
        organisationNameEn: c.item.request.organisation.nameEn,
        organisationNameAr: c.item.request.organisation.nameAr,
        slaDueAt: c.item.request.slaDueAt?.toISOString() ?? null,
        isResubmission: c.item.request.submissionNo > 1,
        documentsFingerprint: c.fingerprint,
      }));

    rows.sort((a, b) => {
      const aDue = a.slaDueAt ? Date.parse(a.slaDueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.slaDueAt ? Date.parse(b.slaDueAt) : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });

    return rows;
  } catch {
    return null;
  }
}

export type RecentAssessmentRow = {
  id: string;
  status: LabelAssessmentStatus;
  requestNo: string;
  organisationName: string;
  serviceItemCode: string;
  updatedAt: string;
  finalVerdict: string | null;
  promotedAt: string | null;
};

/**
 * "Recent evaluations" — assessments already started or finished for this
 * domain, most-recently-updated first. `listNeedsEvaluation` above
 * deliberately excludes anything past EXTRACTING (an ASSESSED assessment
 * with a matching fingerprint drops off that queue by design — it no longer
 * *needs* evaluation). That's correct for the queue, but it left no way for
 * a reviewer to find an item they just finished, or one still mid-run, once
 * it fell out of "needs evaluation" — confirmed live: a completed cosmetics
 * assessment looked "vanished" even though its row was intact. This reads
 * straight off LabelAssessment's own immutable snapshot fields
 * (requestNo/organisationName/serviceItemCode), so it doesn't need — and
 * isn't affected by — RequestItem still existing or the request's current
 * state/documents.
 */
export async function listRecentAssessments(
  domain: LabelEvalDomain,
  limit = 20,
): Promise<RecentAssessmentRow[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const rows = await prisma.labelAssessment.findMany({
      where: { domain },
      select: {
        id: true,
        status: true,
        requestNo: true,
        organisationName: true,
        serviceItemCode: true,
        updatedAt: true,
        finalVerdict: true,
        report: { select: { promotedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      requestNo: r.requestNo,
      organisationName: r.organisationName,
      serviceItemCode: r.serviceItemCode,
      updatedAt: r.updatedAt.toISOString(),
      finalVerdict: r.finalVerdict,
      promotedAt: r.report?.promotedAt?.toISOString() ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Live fingerprint of a single RequestItem's current in-scope source
 * documents (design doc §13.5 race condition: "if a source document's
 * current version changes while an assessment is AWAITING_REVIEW... the UI
 * blocks 'Data confirmed'"). Shares the exact scoping logic with
 * listNeedsEvaluation above — same in-scope codes, same hash source — so
 * the two can never disagree about what "the current documents" means.
 * Returns null if the item has no in-scope documents at all (nothing to
 * compare against).
 */
export async function computeLiveFingerprint(
  requestItemId: string,
  domain: LabelEvalDomain,
): Promise<string | null> {
  const inScopeCodes = new Set(Object.keys(DOCUMENT_KIND_BY_REQUIRED_CODE[domain]));
  const documents = await prisma.requestDocument.findMany({
    where: { requestItemId },
    select: {
      requiredDocument: { select: { code: true } },
      currentVersion: { select: { sha256: true } },
    },
  });
  const hashes = documents
    .filter((d) => d.requiredDocument && inScopeCodes.has(d.requiredDocument.code) && d.currentVersion?.sha256)
    .map((d) => d.currentVersion!.sha256);
  if (hashes.length === 0) return null;
  return computeDocumentsFingerprint(hashes);
}

export class EvaluationUnavailableError extends Error {
  constructor(public readonly currentState: RequestState) {
    super(`Request is not in an evaluable state: ${currentState}`);
    this.name = "EvaluationUnavailableError";
  }
}

/**
 * Re-verifies a RequestItem is still evaluable at the moment a reviewer opens
 * it — independent of, and always re-checked after, the queue list above
 * (design doc §13.5: state can change in the gap between listing and
 * opening). Throws EvaluationUnavailableError (not a generic error) so
 * callers can render "This request is no longer available for evaluation —
 * current status: {state}" rather than a blank failure.
 */
export async function assertRequestItemEvaluable(
  requestItemId: string,
  domain: LabelEvalDomain,
): Promise<{ requestItemId: string; requestId: string; serviceItemId: string }> {
  const session = await requireSession();
  requirePermission(session, "requests:admin");

  const item = await prisma.requestItem.findUnique({
    where: { id: requestItemId },
    select: {
      id: true,
      serviceItemId: true,
      request: { select: { id: true, state: true } },
    },
  });
  if (!item) throw new Error("NOT_FOUND");

  const mapping = await prisma.labelEvalServiceMapping.findUnique({
    where: { serviceItemId: item.serviceItemId },
  });
  if (!mapping || mapping.domain !== domain) throw new Error("WRONG_DOMAIN");

  if (item.request.state !== EVALUATION_READY_STATE) {
    throw new EvaluationUnavailableError(item.request.state);
  }

  return { requestItemId: item.id, requestId: item.request.id, serviceItemId: item.serviceItemId };
}

export type AssessmentDetailField = {
  fieldKey: string;
  valueEn: string | null;
  valueAr: string | null;
  sourceEngine: string;
  confidence: number | null;
  needsReview: boolean;
  confirmedAt: string | null;
};

export type AssessmentDetailVerdict = {
  kbRuleId: string;
  code: string;
  section: string | null;
  titleEn: string | null;
  titleAr: string;
  priority: string | null;
  standard: string | null;
  verdict: string;
  autoOrManual: string;
  evidenceText: string | null;
  rationale: string | null;
};

export type AssessmentDetailClassification = {
  detectedCategoryCode: string | null;
  detectedConfidence: number | null;
  overrideCategoryCode: string | null;
  rationale: string | null;
  notApplicable: boolean;
};

export type AssessmentDetailRequiredTest = {
  testCode: string;
  mandatory: boolean;
  ruleCode: string;
  reasonEn: string | null;
  reasonAr: string | null;
  triggerSource: string | null;
};

export type AssessmentDetailCategory = { code: string; nameEn: string; nameAr: string; icon: string | null };

export type AssessmentDetail = {
  id: string;
  domain: LabelEvalDomain;
  status: string;
  requestNo: string;
  organisationName: string;
  serviceItemCode: string;
  requestItemId: string | null;
  overallRate: number | null;
  finalVerdict: string | null;
  confirmedAt: string | null;
  kbVersionLabel: string;
  kbVersionId: string;
  claimedByName: string | null;
  fields: AssessmentDetailField[];
  verdicts: AssessmentDetailVerdict[];
  promotedAt: string | null;
  classification: AssessmentDetailClassification | null;
  requiredTests: AssessmentDetailRequiredTest[];
  /** Cosmetics only — the active KB version's category taxonomy, for the Reclassify picker. */
  availableCategories: AssessmentDetailCategory[];
};

export async function getAssessmentDetail(assessmentId: string): Promise<AssessmentDetail | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const a = await prisma.labelAssessment.findUnique({
      where: { id: assessmentId },
      select: {
        id: true,
        domain: true,
        status: true,
        requestNo: true,
        organisationName: true,
        serviceItemCode: true,
        requestItemId: true,
        overallRate: true,
        finalVerdict: true,
        confirmedAt: true,
        kbVersion: { select: { id: true, versionLabel: true } },
        claimedByUserId: true,
        fields: {
          select: {
            fieldKey: true,
            valueEn: true,
            valueAr: true,
            sourceEngine: true,
            confidence: true,
            needsReview: true,
            confirmedAt: true,
          },
        },
        verdicts: {
          select: {
            kbRuleId: true,
            verdict: true,
            autoOrManual: true,
            evidenceText: true,
            rationale: true,
            kbRule: { select: { code: true, section: true, titleEn: true, titleAr: true, priority: true, payload: true } },
          },
          // Stable order by rule code — an override must not visibly reshuffle
          // the card list (default insertion order isn't guaranteed stable
          // across upserts).
          orderBy: { kbRule: { code: "asc" } },
        },
        report: { select: { promotedAt: true } },
        classification: {
          select: { detectedCategoryCode: true, detectedConfidence: true, overrideCategoryCode: true, rationale: true, notApplicable: true },
        },
        requiredTests: {
          select: { testCode: true, mandatory: true, ruleCode: true, reasonEn: true, reasonAr: true, triggerSource: true },
        },
      },
    });
    if (!a) return null;

    const claimedByName = a.claimedByUserId
      ? (await prisma.user.findUnique({ where: { id: a.claimedByUserId }, select: { fullNameEn: true } }))?.fullNameEn ?? null
      : null;

    const availableCategories =
      a.domain === "COSMETICS"
        ? await prisma.labelKbCategory.findMany({
            where: { kbVersionId: a.kbVersion.id },
            select: { code: true, nameEn: true, nameAr: true, icon: true },
            orderBy: { sortOrder: "asc" },
          })
        : [];

    return {
      id: a.id,
      domain: a.domain,
      status: a.status,
      requestNo: a.requestNo,
      organisationName: a.organisationName,
      serviceItemCode: a.serviceItemCode,
      requestItemId: a.requestItemId,
      overallRate: a.overallRate,
      finalVerdict: a.finalVerdict,
      confirmedAt: a.confirmedAt?.toISOString() ?? null,
      kbVersionLabel: a.kbVersion.versionLabel,
      kbVersionId: a.kbVersion.id,
      claimedByName,
      classification: a.classification
        ? {
            detectedCategoryCode: a.classification.detectedCategoryCode,
            detectedConfidence: a.classification.detectedConfidence,
            overrideCategoryCode: a.classification.overrideCategoryCode,
            rationale: a.classification.rationale,
            notApplicable: a.classification.notApplicable,
          }
        : null,
      requiredTests: a.requiredTests.map((rt) => ({
        testCode: rt.testCode,
        mandatory: rt.mandatory,
        ruleCode: rt.ruleCode,
        reasonEn: rt.reasonEn,
        reasonAr: rt.reasonAr,
        triggerSource: rt.triggerSource,
      })),
      availableCategories,
      fields: a.fields.map((f) => ({
        fieldKey: f.fieldKey,
        valueEn: f.valueEn,
        valueAr: f.valueAr,
        sourceEngine: f.sourceEngine,
        confidence: f.confidence,
        needsReview: f.needsReview,
        confirmedAt: f.confirmedAt?.toISOString() ?? null,
      })),
      verdicts: a.verdicts.map((v) => ({
        kbRuleId: v.kbRuleId,
        code: v.kbRule.code,
        section: v.kbRule.section,
        titleEn: v.kbRule.titleEn,
        titleAr: v.kbRule.titleAr,
        priority: v.kbRule.priority,
        standard: (v.kbRule.payload as Record<string, unknown> | null)?.standard as string | undefined ?? null,
        verdict: v.verdict,
        autoOrManual: v.autoOrManual,
        evidenceText: v.evidenceText,
        rationale: v.rationale,
      })),
      promotedAt: a.report?.promotedAt?.toISOString() ?? null,
    };
  } catch {
    return null;
  }
}

export type KbVersionRow = {
  id: string;
  versionLabel: string;
  sourceFilename: string;
  status: LabelKbStatus;
  uploadedAt: string;
  uploadedByName: string;
  activatedAt: string | null;
  ruleCount: number;
  lookupCount: number;
  notes: string | null;
};

/** Dataset admin screen (design doc §7.3/§9) — gated on catalogue:manage, not requests:admin. */
export async function listKbVersions(domain: LabelEvalDomain): Promise<KbVersionRow[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const versions = await prisma.labelKbVersion.findMany({
      where: { domain },
      orderBy: { uploadedAt: "desc" },
      include: {
        _count: { select: { rules: true, lookups: true } },
      },
    });

    // No Prisma relation from LabelKbVersion to User (deliberately unconstrained,
    // same as LabelEvalServiceMapping — design doc §14) — resolve names manually.
    const uploaders = await prisma.user.findMany({
      where: { id: { in: [...new Set(versions.map((v) => v.uploadedByUserId))] } },
      select: { id: true, fullNameEn: true },
    });
    const nameById = new Map(uploaders.map((u) => [u.id, u.fullNameEn]));

    return versions.map((v) => ({
      id: v.id,
      versionLabel: v.versionLabel,
      sourceFilename: v.sourceFilename,
      status: v.status,
      uploadedAt: v.uploadedAt.toISOString(),
      uploadedByName: nameById.get(v.uploadedByUserId) ?? v.uploadedByUserId,
      activatedAt: v.activatedAt?.toISOString() ?? null,
      ruleCount: v._count.rules,
      lookupCount: v._count.lookups,
      notes: v.notes,
    }));
  } catch {
    return null;
  }
}
