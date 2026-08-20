"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { parseMoneyInput } from "@/lib/pricing";
import { requirePermission } from "@/lib/rbac";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Service catalogue reference-data CRUD: MainCategory/SubCategory/
 * ServiceItem/RequiredDocument. Split out of the former admin/actions.ts —
 * see workflow-actions.ts for the request-lifecycle actions this used to
 * share a file with.
 */
const toggleServiceItemSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function toggleServiceItemActive(
  input: z.infer<typeof toggleServiceItemSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = toggleServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.serviceItem.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, active: true },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    await prisma.serviceItem.update({
      where: { id: item.id },
      data: { active: parsed.data.active },
    });

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.toggleActive",
      entityType: "ServiceItem",
      entityId: item.id,
      before: { active: item.active },
      after: { active: parsed.data.active },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateServiceItemSchema = z.object({
  id: z.string().min(1),
  subCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  basePrice: z.union([z.string(), z.number()]),
  vatRate: z.union([z.string(), z.number()]),
  slaHours: z.number().int().positive(),
  resubmissionPricePct: z.union([z.string(), z.number()]),
  freeResubmissions: z.number().int().min(0),
  maxResubmissions: z.number().int().min(0),
  sortOrder: z.number().int().min(0),
  requiresInspection: z.boolean().optional(),
  requiresLabTesting: z.boolean().optional(),
  requiresFactoryAudit: z.boolean().optional(),
  defaultEvaluatorId: z.string().min(1).nullable().optional(),
});

export type UpdateServiceItemInput = z.infer<typeof updateServiceItemSchema>;

export async function updateServiceItem(
  input: UpdateServiceItemInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const basePrice = parseMoneyInput(data.basePrice, { min: 0, max: 10_000_000 });
    if (!basePrice) return { ok: false, error: "VALIDATION" };
    const vatRate = parseMoneyInput(data.vatRate, { min: 0, max: 1 });
    if (!vatRate) return { ok: false, error: "VALIDATION" };
    const resubmissionPricePct = parseMoneyInput(data.resubmissionPricePct, {
      min: 0,
      max: 1,
    });
    if (!resubmissionPricePct) return { ok: false, error: "VALIDATION" };

    const existing = await prisma.serviceItem.findUnique({
      where: { id: data.id },
      select: {
        id: true,
        subCategoryId: true,
        code: true,
        basePrice: true,
        vatRate: true,
        slaHours: true,
        nameEn: true,
        nameAr: true,
        sortOrder: true,
      },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: data.subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return { ok: false, error: "NOT_FOUND" };

    if (data.defaultEvaluatorId) {
      const evaluator = await prisma.user.findFirst({
        where: {
          id: data.defaultEvaluatorId,
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "EVALUATOR" } },
        },
        select: { id: true },
      });
      if (!evaluator) return { ok: false, error: "VALIDATION" };
    }

    try {
      await prisma.serviceItem.update({
        where: { id: existing.id },
        data: {
          subCategoryId: data.subCategoryId,
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          basePrice,
          vatRate,
          slaHours: data.slaHours,
          resubmissionPricePct,
          freeResubmissions: data.freeResubmissions,
          maxResubmissions: data.maxResubmissions,
          sortOrder: data.sortOrder,
          requiresInspection: data.requiresInspection ?? false,
          requiresLabTesting: data.requiresLabTesting ?? false,
          requiresFactoryAudit: data.requiresFactoryAudit ?? false,
          defaultEvaluatorId: data.defaultEvaluatorId ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.update",
      entityType: "ServiceItem",
      entityId: existing.id,
      before: {
        subCategoryId: existing.subCategoryId,
        code: existing.code,
        basePrice: existing.basePrice.toString(),
        vatRate: existing.vatRate.toString(),
        slaHours: existing.slaHours,
        nameEn: existing.nameEn,
        nameAr: existing.nameAr,
        sortOrder: existing.sortOrder,
      },
      after: {
        subCategoryId: data.subCategoryId,
        code: data.code,
        basePrice: basePrice.toString(),
        vatRate: vatRate.toString(),
        slaHours: data.slaHours,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        sortOrder: data.sortOrder,
      },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteServiceItemSchema = z.object({
  id: z.string().min(1),
});

export async function deleteServiceItem(
  input: z.infer<typeof deleteServiceItemSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.serviceItem.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    const requestCount = await prisma.requestItem.count({
      where: { serviceItemId: item.id },
    });
    if (requestCount > 0) return { ok: false, error: "HAS_REQUESTS" };

    await prisma.serviceItem.delete({ where: { id: item.id } });

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.delete",
      entityType: "ServiceItem",
      entityId: item.id,
      before: { code: item.code, nameEn: item.nameEn, nameAr: item.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const TEMPLATE_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const TEMPLATE_MAX_MB = 20;

/**
 * Attaches (or replaces) the downloadable blank-form template for a required
 * document slot — e.g. the SAB-001 "Importer declaration" template clients
 * fill on their Importer Header Letter before uploading. Not tied to any
 * request/org, so a catalogue:manage upload is visible to every client.
 */
export async function uploadRequiredDocumentTemplate(formData: FormData): Promise<
  ActionResult<{ requiredDocumentId: string; fileName: string }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const requiredDocumentId = String(formData.get("requiredDocumentId") ?? "");
    if (!requiredDocumentId) return { ok: false, error: "VALIDATION" };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "NO_FILE" };
    }

    const doc = await prisma.requiredDocument.findUnique({
      where: { id: requiredDocumentId },
      select: { id: true, serviceItemId: true, templateStorageKey: true },
    });
    if (!doc) return { ok: false, error: "NOT_FOUND" };

    if (!TEMPLATE_ACCEPTED_MIME_TYPES.includes(file.type)) {
      return { ok: false, error: "MIME_REJECTED" };
    }
    if (file.size > TEMPLATE_MAX_MB * 1024 * 1024) {
      return { ok: false, error: "FILE_TOO_LARGE" };
    }

    const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
    const { storage } = await import("@/lib/storage");
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, TEMPLATE_ACCEPTED_MIME_TYPES)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const stored = await storage.put({
      keyPrefix: `templates/service-documents/${doc.serviceItemId}`,
      fileName: file.name,
      mimeType: sniffed,
      body: buffer,
    });

    const previousKey = doc.templateStorageKey;
    await prisma.requiredDocument.update({
      where: { id: doc.id },
      data: {
        templateStorageKey: stored.key,
        templateFileName: file.name,
        templateMimeType: sniffed,
      },
    });
    if (previousKey) {
      await storage.delete(previousKey);
    }

    await writeAuditLog({
      session,
      action: "catalogue.requiredDocument.template.upload",
      entityType: "RequiredDocument",
      entityId: doc.id,
      after: { fileName: file.name },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { requiredDocumentId: doc.id, fileName: file.name } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    if (message === "AV_UNAVAILABLE") {
      return { ok: false, error: "AV_UNAVAILABLE" };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const removeRequiredDocumentTemplateSchema = z.object({
  requiredDocumentId: z.string().min(1),
});

export async function removeRequiredDocumentTemplate(
  input: z.infer<typeof removeRequiredDocumentTemplateSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = removeRequiredDocumentTemplateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const doc = await prisma.requiredDocument.findUnique({
      where: { id: parsed.data.requiredDocumentId },
      select: { id: true, templateStorageKey: true },
    });
    if (!doc) return { ok: false, error: "NOT_FOUND" };
    if (!doc.templateStorageKey) return { ok: true, data: undefined };

    await prisma.requiredDocument.update({
      where: { id: doc.id },
      data: {
        templateStorageKey: null,
        templateFileName: null,
        templateMimeType: null,
      },
    });
    const { storage } = await import("@/lib/storage");
    await storage.delete(doc.templateStorageKey);

    await writeAuditLog({
      session,
      action: "catalogue.requiredDocument.template.remove",
      entityType: "RequiredDocument",
      entityId: doc.id,
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const requiredDocumentInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  mandatory: z.boolean(),
  acceptedMimeTypes: z.array(z.string().trim().min(1)).min(1),
  maxSizeMb: z.number().int().positive().max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const productAttrFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(["string", "number", "boolean"]),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  required: z.boolean().optional(),
});

const checkSetInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
});

const createServiceItemSchema = z.object({
  subCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  basePrice: z.union([z.string(), z.number()]),
  slaHours: z.number().int().positive(),
  vatRate: z.union([z.string(), z.number()]).optional(),
  resubmissionPricePct: z.union([z.string(), z.number()]).optional(),
  freeResubmissions: z.number().int().min(0).optional(),
  maxResubmissions: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  productAttributes: z.array(productAttrFieldSchema).optional(),
  checkSets: z.array(checkSetInputSchema).optional(),
  requiresInspection: z.boolean().optional(),
  requiresLabTesting: z.boolean().optional(),
  requiresFactoryAudit: z.boolean().optional(),
  requiredDocuments: z.array(requiredDocumentInputSchema),
});

export async function createServiceItem(
  input: z.infer<typeof createServiceItemSchema>,
): Promise<ActionResult<{ serviceItemId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const basePrice = parseMoneyInput(data.basePrice, { min: 0, max: 10_000_000 });
    if (!basePrice) return { ok: false, error: "VALIDATION" };
    const vatRate =
      data.vatRate === undefined
        ? new Prisma.Decimal("0.15")
        : parseMoneyInput(data.vatRate, { min: 0, max: 1 });
    if (!vatRate) return { ok: false, error: "VALIDATION" };
    const resubmissionPricePct =
      data.resubmissionPricePct === undefined
        ? new Prisma.Decimal("0.5")
        : parseMoneyInput(data.resubmissionPricePct, { min: 0, max: 1 });
    if (!resubmissionPricePct) return { ok: false, error: "VALIDATION" };

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: data.subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return { ok: false, error: "NOT_FOUND" };

    const productAttributes = data.productAttributes ?? [];
    const checkSets = data.checkSets ?? [];
    const productAttrSchema: Prisma.InputJsonValue =
      productAttributes.length === 0
        ? {}
        : {
            type: "object",
            properties: Object.fromEntries(
              productAttributes.map((field) => [
                field.key,
                {
                  type: field.type,
                  titleEn: field.titleEn,
                  titleAr: field.titleAr,
                },
              ]),
            ),
            required: productAttributes
              .filter((field) => field.required)
              .map((field) => field.key),
          };

    let serviceItemId: string;
    try {
      serviceItemId = await prisma.$transaction(async (tx) => {
        const item = await tx.serviceItem.create({
          data: {
            subCategoryId: data.subCategoryId,
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            basePrice,
            vatRate,
            resubmissionPricePct,
            slaHours: data.slaHours,
            freeResubmissions: data.freeResubmissions ?? 0,
            maxResubmissions: data.maxResubmissions ?? 3,
            productAttrSchema,
            checkSets,
            requiresInspection: data.requiresInspection ?? false,
            requiresLabTesting: data.requiresLabTesting ?? false,
            requiresFactoryAudit: data.requiresFactoryAudit ?? false,
            sortOrder: data.sortOrder ?? 0,
            active: data.active ?? true,
          },
        });

        if (data.requiredDocuments.length > 0) {
          await tx.requiredDocument.createMany({
            data: data.requiredDocuments.map((doc, index) => ({
              serviceItemId: item.id,
              code: doc.code,
              nameEn: doc.nameEn,
              nameAr: doc.nameAr,
              mandatory: doc.mandatory,
              acceptedMimeTypes: doc.acceptedMimeTypes,
              maxSizeMb: doc.maxSizeMb ?? 50,
              sortOrder: doc.sortOrder ?? index,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.serviceItem.create",
            entityType: "ServiceItem",
            entityId: item.id,
            after: {
              code: item.code,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              subCategoryId: item.subCategoryId,
              requiredDocumentCount: data.requiredDocuments.length,
              productAttributeCount: productAttributes.length,
              checkSetCount: checkSets.length,
            },
          },
        });

        return item.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { serviceItemId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createMainCategorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates a top-level catalogue category. Code is globally unique. */
export async function createMainCategory(
  input: z.infer<typeof createMainCategorySchema>,
): Promise<ActionResult<{ mainCategoryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    let mainCategoryId: string;
    try {
      mainCategoryId = await prisma.$transaction(async (tx) => {
        const category = await tx.mainCategory.create({
          data: {
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            sortOrder: data.sortOrder ?? 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.mainCategory.create",
            entityType: "MainCategory",
            entityId: category.id,
            after: { code: category.code, nameEn: category.nameEn },
          },
        });
        return category.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { mainCategoryId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createSubCategorySchema = z.object({
  mainCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates a subcategory under a main category. Code is unique per parent. */
export async function createSubCategory(
  input: z.infer<typeof createSubCategorySchema>,
): Promise<ActionResult<{ subCategoryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const main = await prisma.mainCategory.findUnique({
      where: { id: data.mainCategoryId },
      select: { id: true },
    });
    if (!main) return { ok: false, error: "NOT_FOUND" };

    let subCategoryId: string;
    try {
      subCategoryId = await prisma.$transaction(async (tx) => {
        const sub = await tx.subCategory.create({
          data: {
            mainCategoryId: data.mainCategoryId,
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            sortOrder: data.sortOrder ?? 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.subCategory.create",
            entityType: "SubCategory",
            entityId: sub.id,
            after: {
              code: sub.code,
              nameEn: sub.nameEn,
              mainCategoryId: sub.mainCategoryId,
            },
          },
        });
        return sub.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { subCategoryId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateMainCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates a top-level catalogue category. Code is globally unique. */
export async function updateMainCategory(
  input: z.infer<typeof updateMainCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.mainCategory.findUnique({
      where: { id: data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.mainCategory.update({
        where: { id: existing.id },
        data: {
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.mainCategory.update",
      entityType: "MainCategory",
      entityId: existing.id,
      before: { code: existing.code, nameEn: existing.nameEn, nameAr: existing.nameAr },
      after: { code: data.code, nameEn: data.nameEn, nameAr: data.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteMainCategorySchema = z.object({
  id: z.string().min(1),
});

/**
 * Deletes a main category. Blocked (not cascaded) if it still has any
 * subcategories — those must be deleted first, which itself is blocked while
 * they hold service items. Keeps catalogue teardown an explicit, auditable
 * two-step process instead of a silent cascade.
 */
export async function deleteMainCategory(
  input: z.infer<typeof deleteMainCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const category = await prisma.mainCategory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!category) return { ok: false, error: "NOT_FOUND" };

    const subCategoryCount = await prisma.subCategory.count({
      where: { mainCategoryId: category.id },
    });
    if (subCategoryCount > 0) return { ok: false, error: "HAS_SUBCATEGORIES" };

    await prisma.mainCategory.delete({ where: { id: category.id } });

    await writeAuditLog({
      session,
      action: "catalogue.mainCategory.delete",
      entityType: "MainCategory",
      entityId: category.id,
      before: { code: category.code, nameEn: category.nameEn, nameAr: category.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateSubCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates a subcategory. Code is unique per parent main category. */
export async function updateSubCategory(
  input: z.infer<typeof updateSubCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.subCategory.findUnique({
      where: { id: data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.subCategory.update({
        where: { id: existing.id },
        data: {
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.subCategory.update",
      entityType: "SubCategory",
      entityId: existing.id,
      before: { code: existing.code, nameEn: existing.nameEn, nameAr: existing.nameAr },
      after: { code: data.code, nameEn: data.nameEn, nameAr: data.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteSubCategorySchema = z.object({
  id: z.string().min(1),
});

/** Deletes a subcategory. Blocked (not cascaded) if it still has service items. */
export async function deleteSubCategory(
  input: z.infer<typeof deleteSubCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const sub = await prisma.subCategory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!sub) return { ok: false, error: "NOT_FOUND" };

    const serviceItemCount = await prisma.serviceItem.count({
      where: { subCategoryId: sub.id },
    });
    if (serviceItemCount > 0) return { ok: false, error: "HAS_SERVICE_ITEMS" };

    await prisma.subCategory.delete({ where: { id: sub.id } });

    await writeAuditLog({
      session,
      action: "catalogue.subCategory.delete",
      entityType: "SubCategory",
      entityId: sub.id,
      before: { code: sub.code, nameEn: sub.nameEn, nameAr: sub.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

