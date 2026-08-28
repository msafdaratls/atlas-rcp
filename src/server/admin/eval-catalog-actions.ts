"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Quality/CoC-team CRUD for the tariff-evaluation catalog templates: the
 * general and labeling checklists (once per TechnicalRegulation) and the
 * specific-standard checklist (once per Standard) — see
 * TariffEvaluationPanel, which reads these templates at runtime. Mirrors
 * saveTechnicalReviewChecklistDefinition (workflow-actions.ts), generalized
 * from a single global singleton to many keyed rows.
 */

/**
 * `applicability` (the regulation clause a row cites, e.g. "المادة ٤ § ١/١/٤ /
 * Article 4 § 1/1/4") and `priority` ("conditional") travel with an item and
 * must round-trip: they are imported from the source regulations and shown
 * under each row during evaluation, so omitting them here would make the first
 * save from this editor silently strip them.
 */
const checklistItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Z0-9_-]+$/, "INVALID_CODE"),
  titleEn: z.string().trim().min(1).max(500),
  titleAr: z.string().trim().min(1).max(500),
  applicability: z.string().trim().max(200).optional(),
  priority: z.string().trim().max(40).optional(),
});

function validateItems(items: z.infer<typeof checklistItemSchema>[]): "DUPLICATE_CODE" | null {
  const codes = new Set(items.map((i) => i.code));
  return codes.size !== items.length ? "DUPLICATE_CODE" : null;
}

const saveGeneralChecklistSchema = z.object({
  technicalRegulationId: z.string().min(1),
  items: z.array(checklistItemSchema).max(100),
});

export async function saveGeneralChecklist(
  input: z.infer<typeof saveGeneralChecklistSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = saveGeneralChecklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const dupError = validateItems(parsed.data.items);
    if (dupError) return { ok: false, error: dupError };

    const checklist = [
      {
        code: "GENERAL",
        titleEn: "General Checklist",
        titleAr: "القائمة العامة",
        items: parsed.data.items,
      },
    ];

    const regulation = await prisma.technicalRegulation.update({
      where: { id: parsed.data.technicalRegulationId },
      data: {
        generalChecklist: checklist as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.generalChecklist.save",
      entityType: "TechnicalRegulation",
      entityId: regulation.id,
      after: { itemCount: parsed.data.items.length },
    });

    revalidatePath("/[locale]/admin/eval-catalog", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const saveLabelingChecklistSchema = z.object({
  technicalRegulationId: z.string().min(1),
  items: z.array(checklistItemSchema).max(100),
});

export async function saveLabelingChecklist(
  input: z.infer<typeof saveLabelingChecklistSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = saveLabelingChecklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const dupError = validateItems(parsed.data.items);
    if (dupError) return { ok: false, error: dupError };

    const checklist = [
      {
        code: "LABEL",
        titleEn: "Labeling Information",
        titleAr: "بيانات البطاقة الإيضاحية",
        items: parsed.data.items,
      },
    ];

    const regulation = await prisma.technicalRegulation.update({
      where: { id: parsed.data.technicalRegulationId },
      data: {
        labelingChecklist: checklist as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.labelingChecklist.save",
      entityType: "TechnicalRegulation",
      entityId: regulation.id,
      after: { itemCount: parsed.data.items.length },
    });

    revalidatePath("/[locale]/admin/eval-catalog", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const saveDocumentsChecklistSchema = z.object({
  technicalRegulationId: z.string().min(1),
  items: z.array(checklistItemSchema).max(100),
});

/**
 * The evaluator-answered required-documents verification list. Separate from
 * the client-facing upload slots (ServiceItem.requiredDocuments): this is
 * "confirm document X is present and valid", not "attach file X".
 */
export async function saveDocumentsChecklist(
  input: z.infer<typeof saveDocumentsChecklistSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = saveDocumentsChecklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const dupError = validateItems(parsed.data.items);
    if (dupError) return { ok: false, error: dupError };

    const checklist = [
      {
        code: "DOCUMENTS",
        titleEn: "Required Documents",
        titleAr: "المستندات المطلوبة",
        items: parsed.data.items,
      },
    ];

    const regulation = await prisma.technicalRegulation.update({
      where: { id: parsed.data.technicalRegulationId },
      data: {
        documentsChecklist: checklist as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.documentsChecklist.save",
      entityType: "TechnicalRegulation",
      entityId: regulation.id,
      after: { itemCount: parsed.data.items.length },
    });

    revalidatePath("/[locale]/admin/eval-catalog", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const saveSpecificStandardChecklistSchema = z.object({
  standardId: z.string().min(1),
  items: z.array(checklistItemSchema).max(200),
});

/**
 * CoC-team-gated: fills in a standard's own detailed test checklist once
 * the department has adopted its actual content — used for both SPECIFIC
 * standards (requirement #6's empty template) and GENERAL standards (whose
 * detailed checklist renders alongside the regulation's own general
 * checklist in TariffEvaluationPanel, per requirement #4's "technical
 * regulation and the general standard").
 */
export async function saveSpecificStandardChecklist(
  input: z.infer<typeof saveSpecificStandardChecklistSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:specific-standard");
    const parsed = saveSpecificStandardChecklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const dupError = validateItems(parsed.data.items);
    if (dupError) return { ok: false, error: dupError };

    const standard = await prisma.standard.findUnique({
      where: { id: parsed.data.standardId },
      select: { id: true, code: true, titleEn: true, titleAr: true, kind: true },
    });
    if (!standard) return { ok: false, error: "NOT_FOUND" };

    const checklist = [
      {
        code: standard.code,
        titleEn: standard.titleEn,
        titleAr: standard.titleAr,
        standard: standard.code,
        items: parsed.data.items,
      },
    ];

    await prisma.standard.update({
      where: { id: standard.id },
      data: {
        checklist: checklist as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.specificStandardChecklist.save",
      entityType: "Standard",
      entityId: standard.id,
      after: { itemCount: parsed.data.items.length },
    });

    revalidatePath("/[locale]/admin/eval-catalog", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
