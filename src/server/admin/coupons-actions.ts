"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { parsePercentCouponValue } from "@/lib/billing-helpers";
import { prisma } from "@/lib/db";
import { parseMoneyInput } from "@/lib/pricing";
import { requirePermission } from "@/lib/rbac";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Coupon management. Split out of the former admin/actions.ts — see
 * workflow-actions.ts for the request-lifecycle actions this used to share
 * a file with.
 */
const setCouponStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED"]),
});

export async function setCouponStatus(
  input: z.infer<typeof setCouponStatusSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");
    const parsed = setCouponStatusSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const coupon = await prisma.coupon.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, status: true },
    });
    if (!coupon) return { ok: false, error: "NOT_FOUND" };

    await prisma.coupon.update({
      where: { id: coupon.id },
      data: { status: parsed.data.status },
    });

    await writeAuditLog({
      session,
      action: "coupon.status.set",
      entityType: "Coupon",
      entityId: coupon.id,
      before: { status: coupon.status },
      after: { status: parsed.data.status },
    });

    revalidatePath("/[locale]/admin/coupons", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createCouponSchema = z
  .object({
    code: z.string().trim().min(2).max(40),
    nameEn: z.string().trim().min(2).max(200),
    nameAr: z.string().trim().min(2).max(200),
    discountType: z.enum(["PERCENT", "FIXED"]),
    value: z.union([z.string(), z.number()]),
    maxDiscountAmount: z.union([z.string(), z.number()]).optional(),
    minOrderAmount: z.union([z.string(), z.number()]).optional(),
    appliesTo: z
      .enum(["ALL", "MAIN_CATEGORY", "SUB_CATEGORY", "SERVICE_ITEM"])
      .optional(),
    appliesToIds: z.array(z.string().min(1)).optional(),
    clientScope: z.enum(["ALL", "SPECIFIC", "NEW_CLIENTS_ONLY"]).optional(),
    clientIds: z.array(z.string().min(1)).optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    totalUsageLimit: z.number().int().positive().optional(),
    perClientLimit: z.number().int().positive().optional(),
    stackable: z.boolean().optional(),
    excludesResubmissions: z.boolean().optional(),
  })
  .refine((data) => data.validTo > data.validFrom, {
    message: "INVALID_DATE_RANGE",
    path: ["validTo"],
  });

export async function createCoupon(
  input: z.infer<typeof createCouponSchema>,
): Promise<ActionResult<{ couponId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");
    const parsed = createCouponSchema.safeParse(input);
    if (!parsed.success) {
      const dateRangeError = parsed.error.issues.some(
        (issue) => issue.message === "INVALID_DATE_RANGE",
      );
      return {
        ok: false,
        error: dateRangeError ? "INVALID_DATE_RANGE" : "VALIDATION",
      };
    }
    const data = parsed.data;

    let value: Prisma.Decimal;
    if (data.discountType === "PERCENT") {
      const raw = parseMoneyInput(data.value, { min: 0.01, max: 100 });
      if (!raw) return { ok: false, error: "VALIDATION" };
      const pct = parsePercentCouponValue(raw);
      if (!pct) return { ok: false, error: "VALIDATION" };
      value = pct;
    } else {
      const fixed = parseMoneyInput(data.value, { min: 0.01, max: 10_000_000 });
      if (!fixed) return { ok: false, error: "VALIDATION" };
      value = fixed;
    }
    const maxDiscountAmount =
      data.maxDiscountAmount === undefined
        ? null
        : parseMoneyInput(data.maxDiscountAmount, { min: 0.01, max: 10_000_000 });
    if (data.maxDiscountAmount !== undefined && !maxDiscountAmount) {
      return { ok: false, error: "VALIDATION" };
    }
    const minOrderAmount =
      data.minOrderAmount === undefined
        ? null
        : parseMoneyInput(data.minOrderAmount, { min: 0.01, max: 10_000_000 });
    if (data.minOrderAmount !== undefined && !minOrderAmount) {
      return { ok: false, error: "VALIDATION" };
    }

    const code = data.code.toUpperCase();

    let couponId: string;
    try {
      const coupon = await prisma.coupon.create({
        data: {
          code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          discountType: data.discountType,
          value,
          maxDiscountAmount,
          minOrderAmount,
          appliesTo: data.appliesTo ?? "ALL",
          appliesToIds: data.appliesToIds ?? [],
          clientScope: data.clientScope ?? "ALL",
          clientIds: data.clientIds ?? [],
          validFrom: data.validFrom,
          validTo: data.validTo,
          totalUsageLimit: data.totalUsageLimit ?? null,
          perClientLimit: data.perClientLimit ?? null,
          stackable: data.stackable ?? false,
          excludesResubmissions: data.excludesResubmissions ?? true,
          status: "ACTIVE",
          createdByUserId: session.id,
        },
      });
      couponId = coupon.id;
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
      action: "coupon.create",
      entityType: "Coupon",
      entityId: couponId,
      after: {
        code,
        nameEn: data.nameEn,
        discountType: data.discountType,
        value: value.toFixed(2),
      },
    });

    revalidatePath("/[locale]/admin/coupons", "page");
    return { ok: true, data: { couponId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

