import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Coupon } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { evaluateCoupon } from "./coupon";

const NOW = new Date("2026-06-15T00:00:00Z");

function coupon(overrides: Partial<Coupon> = {}): Coupon {
  return {
    id: "coupon-1",
    code: "TEST10",
    nameEn: "Test 10%",
    nameAr: "اختبار 10٪",
    discountType: "PERCENT",
    value: new Prisma.Decimal(10),
    maxDiscountAmount: null,
    minOrderAmount: null,
    appliesTo: "ALL",
    appliesToIds: [],
    clientScope: "ALL",
    clientIds: [],
    validFrom: new Date("2026-01-01T00:00:00Z"),
    validTo: new Date("2026-12-31T23:59:59Z"),
    totalUsageLimit: null,
    perClientLimit: null,
    usedCount: 0,
    stackable: false,
    excludesResubmissions: true,
    status: "ACTIVE",
    createdByUserId: "user-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function ctx(overrides: Partial<Parameters<typeof evaluateCoupon>[1]> = {}) {
  return {
    items: [
      {
        serviceItemId: "svc-1",
        mainCategoryId: "main-cosmetics",
        mainCategoryCode: "COSMETICS",
        subCategoryId: "sub-1",
      },
    ],
    basePrice: new Prisma.Decimal(1000),
    submissionNo: 1,
    organisationId: "org-1",
    isNewClient: false,
    priorOrgRedemptions: 0,
    ...overrides,
  };
}

describe("evaluateCoupon — gates", () => {
  it("rejects an inactive coupon", () => {
    const result = evaluateCoupon(coupon({ status: "PAUSED" }), ctx(), NOW);
    assert.deepEqual(result, { ok: false, reason: "INACTIVE" });
  });

  it("rejects before validFrom", () => {
    const result = evaluateCoupon(
      coupon({ validFrom: new Date("2026-07-01T00:00:00Z") }),
      ctx(),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "NOT_YET_VALID" });
  });

  it("rejects after validTo", () => {
    const result = evaluateCoupon(
      coupon({ validTo: new Date("2026-06-01T00:00:00Z") }),
      ctx(),
      NOW,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "EXPIRED");
  });

  it("rejects once totalUsageLimit is reached", () => {
    const result = evaluateCoupon(
      coupon({ totalUsageLimit: 5, usedCount: 5 }),
      ctx(),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "USAGE_EXHAUSTED" });
  });

  it("allows right up to totalUsageLimit - 1", () => {
    const result = evaluateCoupon(
      coupon({ totalUsageLimit: 5, usedCount: 4 }),
      ctx(),
      NOW,
    );
    assert.equal(result.ok, true);
  });

  it("rejects once perClientLimit is reached for this org", () => {
    const result = evaluateCoupon(
      coupon({ perClientLimit: 1 }),
      ctx({ priorOrgRedemptions: 1 }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "PER_CLIENT_LIMIT" });
  });

  it("rejects a resubmission when excludesResubmissions is true", () => {
    const result = evaluateCoupon(
      coupon({ excludesResubmissions: true }),
      ctx({ submissionNo: 2 }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "EXCLUDES_RESUBMISSION" });
  });

  it("allows a resubmission when excludesResubmissions is false", () => {
    const result = evaluateCoupon(
      coupon({ excludesResubmissions: false }),
      ctx({ submissionNo: 2 }),
      NOW,
    );
    assert.equal(result.ok, true);
  });

  it("rejects an order below minOrderAmount", () => {
    const result = evaluateCoupon(
      coupon({ minOrderAmount: new Prisma.Decimal(2000) }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "MIN_ORDER" });
  });

  it("allows an order exactly at minOrderAmount", () => {
    const result = evaluateCoupon(
      coupon({ minOrderAmount: new Prisma.Decimal(1000) }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.equal(result.ok, true);
  });
});

describe("evaluateCoupon — appliesTo scoping", () => {
  it("MAIN_CATEGORY: reports APPLIES_COSMETICS_ONLY when the order is Food & Drugs", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "MAIN_CATEGORY", appliesToIds: ["main-cosmetics"] }),
      ctx({
        items: [
          {
            serviceItemId: "svc-1",
            mainCategoryId: "main-food",
            mainCategoryCode: "FOOD_DRUGS",
            subCategoryId: "sub-1",
          },
        ],
      }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "APPLIES_COSMETICS_ONLY" });
  });

  it("MAIN_CATEGORY: reports APPLIES_FOOD_ONLY when the order is Cosmetics but coupon targets Food", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "MAIN_CATEGORY", appliesToIds: ["main-food"] }),
      ctx(),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "APPLIES_FOOD_ONLY" });
  });

  it("MAIN_CATEGORY: passes when any item in the order matches", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "MAIN_CATEGORY", appliesToIds: ["main-cosmetics"] }),
      ctx(),
      NOW,
    );
    assert.equal(result.ok, true);
  });

  it("SUB_CATEGORY: rejects with APPLIES_CATEGORY when no item matches", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "SUB_CATEGORY", appliesToIds: ["sub-other"] }),
      ctx(),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "APPLIES_CATEGORY" });
  });

  it("SERVICE_ITEM: rejects with APPLIES_SERVICE when no item matches", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "SERVICE_ITEM", appliesToIds: ["svc-other"] }),
      ctx(),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "APPLIES_SERVICE" });
  });

  it("SERVICE_ITEM: passes when the specific item is in the order", () => {
    const result = evaluateCoupon(
      coupon({ appliesTo: "SERVICE_ITEM", appliesToIds: ["svc-1"] }),
      ctx(),
      NOW,
    );
    assert.equal(result.ok, true);
  });
});

describe("evaluateCoupon — client scoping", () => {
  it("NEW_CLIENTS_ONLY: rejects a returning client", () => {
    const result = evaluateCoupon(
      coupon({ clientScope: "NEW_CLIENTS_ONLY" }),
      ctx({ isNewClient: false }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "NEW_CLIENTS_ONLY" });
  });

  it("NEW_CLIENTS_ONLY: passes a new client", () => {
    const result = evaluateCoupon(
      coupon({ clientScope: "NEW_CLIENTS_ONLY" }),
      ctx({ isNewClient: true }),
      NOW,
    );
    assert.equal(result.ok, true);
  });

  it("SPECIFIC: rejects an org not in clientIds", () => {
    const result = evaluateCoupon(
      coupon({ clientScope: "SPECIFIC", clientIds: ["org-vip"] }),
      ctx({ organisationId: "org-1" }),
      NOW,
    );
    assert.deepEqual(result, { ok: false, reason: "CLIENT_NOT_ELIGIBLE" });
  });

  it("SPECIFIC: passes an org listed in clientIds", () => {
    const result = evaluateCoupon(
      coupon({ clientScope: "SPECIFIC", clientIds: ["org-1"] }),
      ctx({ organisationId: "org-1" }),
      NOW,
    );
    assert.equal(result.ok, true);
  });
});

describe("evaluateCoupon — discount math", () => {
  it("computes a straight percentage discount", () => {
    const result = evaluateCoupon(
      coupon({ discountType: "PERCENT", value: new Prisma.Decimal(10) }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.discount.toString(), "100");
  });

  it("uses a fixed discount as-is", () => {
    const result = evaluateCoupon(
      coupon({ discountType: "FIXED", value: new Prisma.Decimal(50) }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.discount.toString(), "50");
  });

  it("clamps a percentage discount to maxDiscountAmount", () => {
    const result = evaluateCoupon(
      coupon({
        discountType: "PERCENT",
        value: new Prisma.Decimal(50),
        maxDiscountAmount: new Prisma.Decimal(100),
      }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.discount.toString(), "100");
  });

  it("clamps a fixed discount that exceeds the order total (never a negative charge)", () => {
    const result = evaluateCoupon(
      coupon({ discountType: "FIXED", value: new Prisma.Decimal(5000) }),
      ctx({ basePrice: new Prisma.Decimal(1000) }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.discount.toString(), "1000");
  });

  it("rounds the discount to 2 decimal places", () => {
    const result = evaluateCoupon(
      coupon({ discountType: "PERCENT", value: new Prisma.Decimal(33.333) }),
      ctx({ basePrice: new Prisma.Decimal(100) }),
      NOW,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.discount.toString(), "33.33");
  });
});
