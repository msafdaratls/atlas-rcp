"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCheckSets } from "@/lib/assessment";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import {
  buildSections,
  hashSections,
  isTariffEvalServiceCode,
  parseSectionVerdicts,
  parseSnapshot,
  scoreSnapshot,
  snapshotItemCount,
  type SectionVerdicts,
  type TariffEvaluationSnapshot,
} from "@/lib/tariff-evaluation-services";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Runtime server actions behind TariffEvaluationPanel.
 *
 * Every read of "what is being evaluated" comes from the evaluation's own
 * `templateSnapshot`, pinned when the tariff item was selected — never from
 * the live catalog. That is what lets Quality import a regulation update at
 * any time without disturbing evaluations already under way or finished.
 */

const EDIT_STATES = ["ASSESSMENT_RUNNING"] as const;

function isEditableState(state: string): boolean {
  return (EDIT_STATES as readonly string[]).includes(state);
}

// ─── Tariff item lookup (catalog-side, not evaluation-side) ──────────────────

const listTariffItemsSchema = z.object({
  technicalRegulationId: z.string().min(1),
  query: z.string().trim().max(200).optional(),
});

/** Lightweight tariff-item options for the HS-code picker, fetched on demand so the request page never ships a 1,527-row list. */
export async function listTariffItemsForRegulation(
  input: z.infer<typeof listTariffItemsSchema>,
): Promise<
  ActionResult<Array<{ id: string; hsCode: string; productTitleEn: string; productTitleAr: string }>>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = listTariffItemsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const q = parsed.data.query?.trim();
    const items = await prisma.tariffItem.findMany({
      where: {
        technicalRegulationId: parsed.data.technicalRegulationId,
        active: true,
        ...(q
          ? {
              OR: [
                { hsCode: { contains: q } },
                { productTitleEn: { contains: q, mode: "insensitive" } },
                { productTitleAr: { contains: q } },
              ],
            }
          : {}),
      },
      select: { id: true, hsCode: true, productTitleEn: true, productTitleAr: true },
      // hsCode breaks the tie: every imported item shares sortOrder 0, so
      // without it the capped rows would be an arbitrary, non-repeatable slice.
      orderBy: [{ sortOrder: "asc" }, { hsCode: "asc" }],
      take: 200,
    });
    return { ok: true, data: items };
  } catch (error) {
    return failure(error, "LOAD_FAILED");
  }
}

// ─── Snapshot assembly ──────────────────────────────────────────────────────

/** Reads the live catalog and freezes it into the shape an evaluation is judged against. */
async function buildSnapshot(
  client: Prisma.TransactionClient | typeof prisma,
  technicalRegulationId: string,
  tariffItemId: string,
): Promise<TariffEvaluationSnapshot | null> {
  const [regulation, tariffItem] = await Promise.all([
    client.technicalRegulation.findUnique({
      where: { id: technicalRegulationId },
      select: {
        id: true,
        code: true,
        titleEn: true,
        titleAr: true,
        generalChecklist: true,
        labelingChecklist: true,
        documentsChecklist: true,
        standards: {
          where: { kind: "GENERAL", active: true },
          select: { id: true, code: true, titleEn: true, titleAr: true, checklist: true },
          orderBy: { code: "asc" },
        },
      },
    }),
    client.tariffItem.findUnique({
      where: { id: tariffItemId },
      select: {
        id: true,
        hsCode: true,
        productTitleEn: true,
        productTitleAr: true,
        requiredCertificates: true,
        conformityModule: true,
        technicalRegulationId: true,
        specificStandards: {
          // kind is filtered here as well as at import: a GENERAL standard that
          // is also linked to the item would build two sections sharing one
          // `std:<id>` key, so a single answer would be counted twice and React
          // would see duplicate keys.
          where: { standard: { active: true, kind: "SPECIFIC" } },
          select: {
            standard: { select: { id: true, code: true, titleEn: true, titleAr: true, checklist: true } },
          },
          orderBy: [{ sortOrder: "asc" }, { standardId: "asc" }],
        },
      },
    }),
  ]);

  if (!regulation || !tariffItem) return null;
  if (tariffItem.technicalRegulationId !== regulation.id) return null;

  const generalStandards = regulation.standards.map((s) => ({
    id: s.id,
    code: s.code,
    titleEn: s.titleEn,
    titleAr: s.titleAr,
    checklist: parseCheckSets(s.checklist),
  }));
  const specificStandards = tariffItem.specificStandards.map((link) => ({
    id: link.standard.id,
    code: link.standard.code,
    titleEn: link.standard.titleEn,
    titleAr: link.standard.titleAr,
    checklist: parseCheckSets(link.standard.checklist),
  }));

  const sections = buildSections({
    regulation: {
      generalChecklist: parseCheckSets(regulation.generalChecklist),
      labelingChecklist: parseCheckSets(regulation.labelingChecklist),
      documentsChecklist: parseCheckSets(regulation.documentsChecklist),
    },
    generalStandards,
    specificStandards,
  });

  const strip = ({ id, code, titleEn, titleAr }: (typeof generalStandards)[number]) => ({
    id,
    code,
    titleEn,
    titleAr,
  });

  return {
    version: 1,
    regulation: {
      id: regulation.id,
      code: regulation.code,
      titleEn: regulation.titleEn,
      titleAr: regulation.titleAr,
    },
    tariffItem: {
      id: tariffItem.id,
      hsCode: tariffItem.hsCode,
      productTitleEn: tariffItem.productTitleEn,
      productTitleAr: tariffItem.productTitleAr,
      requiredCertificates: tariffItem.requiredCertificates,
      conformityModule: tariffItem.conformityModule,
    },
    generalStandards: generalStandards.map(strip),
    specificStandards: specificStandards.map(strip),
    sections,
    hash: hashSections(sections),
  };
}

export type TariffEvaluationBundle = {
  id: string;
  technicalRegulationId: string;
  tariffItemId: string;
  snapshot: TariffEvaluationSnapshot;
  sectionVerdicts: SectionVerdicts;
  finalDecision: string | null;
  completedAt: string | null;
};

function toBundle(row: {
  id: string;
  technicalRegulationId: string;
  tariffItemId: string;
  templateSnapshot: Prisma.JsonValue;
  sectionVerdicts: Prisma.JsonValue;
  finalDecision: string | null;
  completedAt: Date | null;
}): TariffEvaluationBundle | null {
  const snapshot = parseSnapshot(row.templateSnapshot);
  if (!snapshot) return null;
  return {
    id: row.id,
    technicalRegulationId: row.technicalRegulationId,
    tariffItemId: row.tariffItemId,
    snapshot,
    sectionVerdicts: parseSectionVerdicts(row.sectionVerdicts),
    finalDecision: row.finalDecision,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function loadBundle(requestItemId: string): Promise<TariffEvaluationBundle | null> {
  const row = await prisma.tariffEvaluation.findUnique({ where: { requestItemId } });
  return row ? toBundle(row) : null;
}

// ─── Select / re-select ─────────────────────────────────────────────────────

const completeSchema = z.object({ requestItemId: z.string().min(1) });

const selectTariffEvaluationSchema = z.object({
  requestItemId: z.string().min(1),
  technicalRegulationId: z.string().min(1),
  tariffItemId: z.string().min(1),
});

/** Selects (or re-selects) the regulation + tariff item, pinning the template snapshot. */
export async function selectTariffEvaluation(
  input: z.infer<typeof selectTariffEvaluationSchema>,
): Promise<ActionResult<TariffEvaluationBundle>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = selectTariffEvaluationSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.requestItem.findUnique({
      where: { id: parsed.data.requestItemId },
      select: {
        id: true,
        serviceItem: { select: { code: true } },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (!isTariffEvalServiceCode(item.serviceItem.code)) return { ok: false, error: "INVALID_SERVICE" };
    if (!isEditableState(item.request.state)) return { ok: false, error: "INVALID_STATE" };

    const existing = await prisma.tariffEvaluation.findUnique({
      where: { requestItemId: item.id },
      select: { technicalRegulationId: true, tariffItemId: true, completedAt: true },
    });

    const unchanged =
      existing?.technicalRegulationId === parsed.data.technicalRegulationId &&
      existing?.tariffItemId === parsed.data.tariffItemId;

    // Re-picking the same item must not silently discard work. Re-picking it on
    // an already-completed evaluation is refused outright: the evaluator has to
    // reopen it deliberately rather than have the decision quietly linger.
    if (unchanged) {
      if (existing?.completedAt) return { ok: false, error: "ALREADY_COMPLETED" };
      const bundle = await loadBundle(item.id);
      if (bundle) return { ok: true, data: bundle };
    }

    const snapshot = await buildSnapshot(
      prisma,
      parsed.data.technicalRegulationId,
      parsed.data.tariffItemId,
    );
    if (!snapshot) return { ok: false, error: "NOT_FOUND" };

    const snapshotJson = snapshot as unknown as Prisma.InputJsonValue;
    await prisma.tariffEvaluation.upsert({
      where: { requestItemId: item.id },
      create: {
        requestItemId: item.id,
        technicalRegulationId: parsed.data.technicalRegulationId,
        tariffItemId: parsed.data.tariffItemId,
        templateSnapshot: snapshotJson,
        snapshotAt: new Date(),
        updatedByUserId: session.id,
      },
      update: {
        technicalRegulationId: parsed.data.technicalRegulationId,
        tariffItemId: parsed.data.tariffItemId,
        // A different tariff item means different checklists, so prior answers
        // and any decision no longer apply.
        sectionVerdicts: {},
        templateSnapshot: snapshotJson,
        snapshotAt: new Date(),
        finalDecision: null,
        completedAt: null,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: "request.tariffEvaluation.select",
      entityType: "RequestItem",
      entityId: item.id,
      after: {
        technicalRegulationId: parsed.data.technicalRegulationId,
        tariffItemId: parsed.data.tariffItemId,
        templateHash: snapshot.hash,
      },
    });

    const bundle = await loadBundle(item.id);
    if (!bundle) return { ok: false, error: "SAVE_FAILED" };

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
    return { ok: true, data: bundle };
  } catch (error) {
    return failure(error, "SAVE_FAILED");
  }
}

/**
 * Deliberately adopt the current catalog into an in-flight evaluation.
 *
 * Answers whose item codes survive the new template are kept; the rest are
 * reported so the evaluator knows what has to be re-answered.
 */
export async function refreshTariffEvaluationTemplate(
  input: z.infer<typeof completeSchema>,
): Promise<ActionResult<{ bundle: TariffEvaluationBundle; droppedAnswers: number }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const row = await prisma.tariffEvaluation.findUnique({
      where: { requestItemId: parsed.data.requestItemId },
      include: { requestItem: { select: { request: { select: { id: true, state: true, organisationId: true } } } } },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (!isEditableState(row.requestItem.request.state)) return { ok: false, error: "INVALID_STATE" };
    if (row.completedAt) return { ok: false, error: "ALREADY_COMPLETED" };

    const snapshot = await buildSnapshot(prisma, row.technicalRegulationId, row.tariffItemId);
    if (!snapshot) return { ok: false, error: "NOT_FOUND" };

    const previous = parseSectionVerdicts(row.sectionVerdicts);
    const next: SectionVerdicts = {};
    let kept = 0;
    let total = 0;
    for (const [, state] of Object.entries(previous)) total += Object.keys(state.verdicts).length;

    for (const section of snapshot.sections) {
      const known = new Set(section.checkSets.flatMap((set) => set.items.map((i) => i.code)));
      const carried: Record<string, (typeof previous)[string]["verdicts"][string]> = {};
      for (const [code, verdict] of Object.entries(previous[section.key]?.verdicts ?? {})) {
        if (known.has(code)) {
          carried[code] = verdict;
          kept += 1;
        }
      }
      if (Object.keys(carried).length > 0) next[section.key] = { verdicts: carried };
    }

    await prisma.tariffEvaluation.update({
      where: { id: row.id },
      data: {
        templateSnapshot: snapshot as unknown as Prisma.InputJsonValue,
        snapshotAt: new Date(),
        sectionVerdicts: next as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: row.requestItem.request.organisationId,
      action: "request.tariffEvaluation.refreshTemplate",
      entityType: "RequestItem",
      entityId: row.requestItemId,
      after: { templateHash: snapshot.hash, keptAnswers: kept, droppedAnswers: total - kept },
    });

    const bundle = await loadBundle(row.requestItemId);
    if (!bundle) return { ok: false, error: "SAVE_FAILED" };

    revalidatePath(`/[locale]/admin/requests/${row.requestItem.request.id}`, "page");
    return { ok: true, data: { bundle, droppedAnswers: total - kept } };
  } catch (error) {
    return failure(error, "SAVE_FAILED");
  }
}

// ─── Save verdicts ──────────────────────────────────────────────────────────

const saveVerdictsSchema = z.object({
  requestItemId: z.string().min(1),
  sectionKey: z.string().min(1).max(80),
  /** Echoed back from the loaded snapshot so a stale panel is detected, not silently truncated. */
  templateHash: z.string().min(1).max(64),
  verdicts: z.record(z.string(), z.enum(["COMPLIANT", "NON_COMPLIANT", "NA"])),
});

export async function saveTariffEvaluationVerdicts(
  input: z.infer<typeof saveVerdictsSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = saveVerdictsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const row = await prisma.tariffEvaluation.findUnique({
      where: { requestItemId: parsed.data.requestItemId },
      include: { requestItem: { select: { request: { select: { id: true, state: true, organisationId: true } } } } },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (!isEditableState(row.requestItem.request.state)) return { ok: false, error: "INVALID_STATE" };

    const snapshot = parseSnapshot(row.templateSnapshot);
    if (!snapshot) return { ok: false, error: "NOT_FOUND" };

    // Without this the panel could be showing a template that no longer
    // matches, and unmatched answers would be dropped under a "Saved" toast.
    if (snapshot.hash !== parsed.data.templateHash) return { ok: false, error: "TEMPLATE_CHANGED" };

    const section = snapshot.sections.find((s) => s.key === parsed.data.sectionKey);
    if (!section) return { ok: false, error: "UNKNOWN_SECTION" };

    const known = new Set(section.checkSets.flatMap((set) => set.items.map((i) => i.code)));
    const verdicts: Record<string, "COMPLIANT" | "NON_COMPLIANT" | "NA"> = {};
    for (const [code, verdict] of Object.entries(parsed.data.verdicts)) {
      if (known.has(code)) verdicts[code] = verdict;
    }

    const next = parseSectionVerdicts(row.sectionVerdicts);
    next[parsed.data.sectionKey] = { verdicts };

    await prisma.tariffEvaluation.update({
      where: { id: row.id },
      data: {
        sectionVerdicts: next as unknown as Prisma.InputJsonValue,
        // Editing after a completion invalidates the decision that was based
        // on the old answers.
        finalDecision: null,
        completedAt: null,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: row.requestItem.request.organisationId,
      action: "request.tariffEvaluation.saveVerdicts",
      entityType: "RequestItem",
      entityId: row.requestItemId,
      after: { section: parsed.data.sectionKey, answered: Object.keys(verdicts).length },
    });

    revalidatePath(`/[locale]/admin/requests/${row.requestItem.request.id}`, "page");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "SAVE_FAILED");
  }
}

// ─── Complete ───────────────────────────────────────────────────────────────


/** Scores every section against the pinned snapshot and stores the decision. */
export async function completeTariffEvaluation(
  input: z.infer<typeof completeSchema>,
): Promise<ActionResult<{ recommendation: string; complete: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const row = await prisma.tariffEvaluation.findUnique({
      where: { requestItemId: parsed.data.requestItemId },
      include: { requestItem: { select: { request: { select: { id: true, state: true, organisationId: true } } } } },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (!isEditableState(row.requestItem.request.state)) return { ok: false, error: "INVALID_STATE" };

    const snapshot = parseSnapshot(row.templateSnapshot);
    if (!snapshot) return { ok: false, error: "NOT_FOUND" };

    // An unconfigured regulation must not quietly pass as ACCEPTED — there was
    // nothing to assess, which is a catalog problem, not a conformant product.
    if (snapshotItemCount(snapshot) === 0) return { ok: false, error: "NO_CHECKLIST_ITEMS" };

    const summary = scoreSnapshot(snapshot, parseSectionVerdicts(row.sectionVerdicts));
    if (!summary.complete) return { ok: false, error: "INCOMPLETE" };

    await prisma.tariffEvaluation.update({
      where: { id: row.id },
      data: {
        finalDecision: summary.recommendation,
        completedAt: new Date(),
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: row.requestItem.request.organisationId,
      action: "request.tariffEvaluation.complete",
      entityType: "RequestItem",
      entityId: row.requestItemId,
      after: {
        recommendation: summary.recommendation,
        templateHash: snapshot.hash,
        nonCompliant: summary.nonCompliant,
      },
    });

    revalidatePath(`/[locale]/admin/requests/${row.requestItem.request.id}`, "page");
    return { ok: true, data: { recommendation: summary.recommendation, complete: summary.complete } };
  } catch (error) {
    return failure(error, "SAVE_FAILED");
  }
}

function failure(error: unknown, fallback: string): ActionResult<never> {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
    return { ok: false, error: message };
  }
  return { ok: false, error: fallback };
}
