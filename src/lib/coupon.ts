import type { Coupon, CouponAppliesTo, CouponClientScope, Prisma } from "@prisma/client";

export type CouponFailureReason =
  | "NOT_FOUND"
  | "INACTIVE"
  | "EXPIRED"
  | "NOT_YET_VALID"
  | "MIN_ORDER"
  | "USAGE_EXHAUSTED"
  | "PER_CLIENT_LIMIT"
  | "APPLIES_COSMETICS_ONLY"
  | "APPLIES_FOOD_ONLY"
  | "APPLIES_CATEGORY"
  | "APPLIES_SERVICE"
  | "NEW_CLIENTS_ONLY"
  | "CLIENT_NOT_ELIGIBLE"
  | "EXCLUDES_RESUBMISSION";

export type CouponEvalResult =
  | { ok: true; discount: Prisma.Decimal }
  | { ok: false; reason: CouponFailureReason; meta?: Record<string, string> };

type OrderItemContext = {
  serviceItemId: string;
  mainCategoryId: string;
  mainCategoryCode: string;
  subCategoryId: string;
};

type ServiceContext = {
  /** One entry per RequestItem in the order/draft; a category-scoped coupon
   * matches if ANY item satisfies its appliesTo restriction. */
  items: OrderItemContext[];
  /** Order subtotal (sum of every item's basePrice) — the discount and
   * minOrderAmount check operate on the whole order, not a single item. */
  basePrice: Prisma.Decimal;
  submissionNo: number;
  organisationId: string;
  isNewClient: boolean;
  priorOrgRedemptions: number;
};

export function evaluateCoupon(
  coupon: Coupon,
  ctx: ServiceContext,
  now = new Date(),
): CouponEvalResult {
  if (coupon.status !== "ACTIVE") {
    return { ok: false, reason: "INACTIVE" };
  }
  if (now < coupon.validFrom) {
    return { ok: false, reason: "NOT_YET_VALID" };
  }
  if (now > coupon.validTo) {
    return {
      ok: false,
      reason: "EXPIRED",
      meta: { expiredOn: coupon.validTo.toISOString().slice(0, 10) },
    };
  }
  if (
    coupon.totalUsageLimit != null &&
    coupon.usedCount >= coupon.totalUsageLimit
  ) {
    return { ok: false, reason: "USAGE_EXHAUSTED" };
  }
  if (
    coupon.perClientLimit != null &&
    ctx.priorOrgRedemptions >= coupon.perClientLimit
  ) {
    return { ok: false, reason: "PER_CLIENT_LIMIT" };
  }
  if (coupon.excludesResubmissions && ctx.submissionNo > 1) {
    return { ok: false, reason: "EXCLUDES_RESUBMISSION" };
  }
  if (
    coupon.minOrderAmount &&
    ctx.basePrice.lessThan(coupon.minOrderAmount)
  ) {
    return { ok: false, reason: "MIN_ORDER" };
  }

  const scopeFail = evaluateAppliesTo(coupon.appliesTo, coupon.appliesToIds, ctx);
  if (scopeFail) return scopeFail;

  const clientFail = evaluateClientScope(
    coupon.clientScope,
    coupon.clientIds,
    ctx,
  );
  if (clientFail) return clientFail;

  let discount =
    coupon.discountType === "PERCENT"
      ? ctx.basePrice.mul(coupon.value).div(100)
      : coupon.value;

  if (coupon.maxDiscountAmount && discount.greaterThan(coupon.maxDiscountAmount)) {
    discount = coupon.maxDiscountAmount;
  }
  if (discount.greaterThan(ctx.basePrice)) {
    discount = ctx.basePrice;
  }

  return { ok: true, discount: discount.toDecimalPlaces(2) };
}

function evaluateAppliesTo(
  appliesTo: CouponAppliesTo,
  ids: string[],
  ctx: ServiceContext,
): CouponEvalResult | null {
  if (appliesTo === "ALL") return null;
  if (appliesTo === "MAIN_CATEGORY") {
    if (!ctx.items.some((i) => ids.includes(i.mainCategoryId))) {
      const code = ctx.items[0]?.mainCategoryCode;
      if (code === "FOOD_DRUGS") {
        return { ok: false, reason: "APPLIES_COSMETICS_ONLY" };
      }
      if (code === "COSMETICS") {
        return { ok: false, reason: "APPLIES_FOOD_ONLY" };
      }
      return { ok: false, reason: "APPLIES_CATEGORY" };
    }
    return null;
  }
  if (appliesTo === "SUB_CATEGORY") {
    if (!ctx.items.some((i) => ids.includes(i.subCategoryId))) {
      return { ok: false, reason: "APPLIES_CATEGORY" };
    }
    return null;
  }
  if (appliesTo === "SERVICE_ITEM") {
    if (!ctx.items.some((i) => ids.includes(i.serviceItemId))) {
      return { ok: false, reason: "APPLIES_SERVICE" };
    }
    return null;
  }
  return null;
}

function evaluateClientScope(
  scope: CouponClientScope,
  clientIds: string[],
  ctx: ServiceContext,
): CouponEvalResult | null {
  if (scope === "ALL") return null;
  if (scope === "NEW_CLIENTS_ONLY" && !ctx.isNewClient) {
    return { ok: false, reason: "NEW_CLIENTS_ONLY" };
  }
  if (scope === "SPECIFIC" && !clientIds.includes(ctx.organisationId)) {
    return { ok: false, reason: "CLIENT_NOT_ELIGIBLE" };
  }
  return null;
}
