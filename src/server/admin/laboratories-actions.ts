"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import type { ActionResult } from "@/server/admin/workflow-actions";

// ─── Laboratories & Test Catalogue ─────────────────────────────────────────
// Reference-data CRUD for Lab Testing Coordination (LAB-001): the accredited
// laboratories samples can be sent to, and the catalogue of test types used
// to build a request item's structured "required tests" checklist. Mirrors
// createMainCategory/updateMainCategory/deleteMainCategory's flat-record
// pattern — neither entity has nested child records like ServiceItem does.

const createLaboratorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  accreditationScopeEn: z.string().trim().max(2000).optional(),
  accreditationScopeAr: z.string().trim().max(2000).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
  contactPhone: z.string().trim().max(60).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates an accredited-laboratory reference-data row. Code is globally unique. */
export async function createLaboratory(
  input: z.infer<typeof createLaboratorySchema>,
): Promise<ActionResult<{ laboratoryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = createLaboratorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    let laboratoryId: string;
    try {
      laboratoryId = await prisma.$transaction(async (tx) => {
        const lab = await tx.laboratory.create({
          data: {
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            accreditationScopeEn: data.accreditationScopeEn || null,
            accreditationScopeAr: data.accreditationScopeAr || null,
            contactName: data.contactName || null,
            contactEmail: data.contactEmail || null,
            contactPhone: data.contactPhone || null,
            sortOrder: data.sortOrder ?? 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "laboratories.laboratory.create",
            entityType: "Laboratory",
            entityId: lab.id,
            after: { code: lab.code, nameEn: lab.nameEn },
          },
        });
        return lab.id;
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

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: { laboratoryId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateLaboratorySchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  accreditationScopeEn: z.string().trim().max(2000).optional(),
  accreditationScopeAr: z.string().trim().max(2000).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().trim().email().max(200).optional(),
  contactPhone: z.string().trim().max(60).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates an accredited-laboratory row. Code is globally unique. */
export async function updateLaboratory(
  input: z.infer<typeof updateLaboratorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = updateLaboratorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.laboratory.findUnique({
      where: { id: data.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.laboratory.update({
        where: { id: data.id },
        data: {
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          accreditationScopeEn: data.accreditationScopeEn || null,
          accreditationScopeAr: data.accreditationScopeAr || null,
          contactName: data.contactName || null,
          contactEmail: data.contactEmail || null,
          contactPhone: data.contactPhone || null,
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
      action: "laboratories.laboratory.update",
      entityType: "Laboratory",
      entityId: data.id,
      after: { code: data.code, nameEn: data.nameEn },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const toggleLaboratoryActiveSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function toggleLaboratoryActive(
  input: z.infer<typeof toggleLaboratoryActiveSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = toggleLaboratoryActiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const lab = await prisma.laboratory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, active: true },
    });
    if (!lab) return { ok: false, error: "NOT_FOUND" };

    await prisma.laboratory.update({
      where: { id: lab.id },
      data: { active: parsed.data.active },
    });

    await writeAuditLog({
      session,
      action: "laboratories.laboratory.toggleActive",
      entityType: "Laboratory",
      entityId: lab.id,
      before: { active: lab.active },
      after: { active: parsed.data.active },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteLaboratorySchema = z.object({ id: z.string().min(1) });

/** Hard-deletes a laboratory. Blocked while any request activity references it. */
export async function deleteLaboratory(
  input: z.infer<typeof deleteLaboratorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = deleteLaboratorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const lab = await prisma.laboratory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!lab) return { ok: false, error: "NOT_FOUND" };

    const usageCount = await prisma.requestItemActivity.count({
      where: { laboratoryId: lab.id },
    });
    if (usageCount > 0) return { ok: false, error: "HAS_REQUESTS" };

    await prisma.laboratory.delete({ where: { id: lab.id } });

    await writeAuditLog({
      session,
      action: "laboratories.laboratory.delete",
      entityType: "Laboratory",
      entityId: lab.id,
      before: { code: lab.code, nameEn: lab.nameEn, nameAr: lab.nameAr },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createTestTypeSchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates a lab test-type catalogue row. Code is globally unique. */
export async function createTestType(
  input: z.infer<typeof createTestTypeSchema>,
): Promise<ActionResult<{ testTypeId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = createTestTypeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    let testTypeId: string;
    try {
      testTypeId = await prisma.$transaction(async (tx) => {
        const testType = await tx.testType.create({
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
            action: "laboratories.testType.create",
            entityType: "TestType",
            entityId: testType.id,
            after: { code: testType.code, nameEn: testType.nameEn },
          },
        });
        return testType.id;
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

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: { testTypeId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateTestTypeSchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates a lab test-type catalogue row. Code is globally unique. */
export async function updateTestType(
  input: z.infer<typeof updateTestTypeSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = updateTestTypeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.testType.findUnique({
      where: { id: data.id },
      select: { id: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.testType.update({
        where: { id: data.id },
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
      action: "laboratories.testType.update",
      entityType: "TestType",
      entityId: data.id,
      after: { code: data.code, nameEn: data.nameEn },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const toggleTestTypeActiveSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function toggleTestTypeActive(
  input: z.infer<typeof toggleTestTypeActiveSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = toggleTestTypeActiveSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const testType = await prisma.testType.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, active: true },
    });
    if (!testType) return { ok: false, error: "NOT_FOUND" };

    await prisma.testType.update({
      where: { id: testType.id },
      data: { active: parsed.data.active },
    });

    await writeAuditLog({
      session,
      action: "laboratories.testType.toggleActive",
      entityType: "TestType",
      entityId: testType.id,
      before: { active: testType.active },
      after: { active: parsed.data.active },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteTestTypeSchema = z.object({ id: z.string().min(1) });

/** Hard-deletes a test type. Blocked while any required-tests checklist row references it. */
export async function deleteTestType(
  input: z.infer<typeof deleteTestTypeSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");
    const parsed = deleteTestTypeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const testType = await prisma.testType.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!testType) return { ok: false, error: "NOT_FOUND" };

    const usageCount = await prisma.requestItemRequiredTest.count({
      where: { testTypeId: testType.id },
    });
    if (usageCount > 0) return { ok: false, error: "HAS_REQUESTS" };

    await prisma.testType.delete({ where: { id: testType.id } });

    await writeAuditLog({
      session,
      action: "laboratories.testType.delete",
      entityType: "TestType",
      entityId: testType.id,
      before: { code: testType.code, nameEn: testType.nameEn, nameAr: testType.nameAr },
    });

    revalidatePath("/[locale]/admin/laboratories", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
