import { Prisma } from "@prisma/client";

/** Invoice due date from issuedAt + organisation payment terms (0 = cash / due on issue). */
export function invoiceDueAt(issuedAt: Date, paymentTermsDays: number): Date {
  const days = Math.max(0, Math.floor(paymentTermsDays));
  return new Date(issuedAt.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * `maxResubmissions` is the number of *resubmits* allowed after the first
 * submission. With max=1, submissionNo may reach 2 (initial + one return).
 */
export function exceedsMaxResubmissions(
  currentSubmissionNo: number,
  maxResubmissions: number,
): boolean {
  const next = currentSubmissionNo + 1;
  return next > 1 + Math.max(0, maxResubmissions);
}

/** New-client coupon scope: never submitted a chargeable/lifecycle request. */
export function isNewClientOrg(priorSubmittedCount: number): boolean {
  return priorSubmittedCount === 0;
}

/** Prisma where fragment: requests that count as “submitted” for new-client. */
export const SUBMITTED_LIFECYCLE_WHERE = {
  submittedAt: { not: null },
} as const;

export function parsePercentCouponValue(
  value: Prisma.Decimal,
): Prisma.Decimal | null {
  if (value.lessThanOrEqualTo(0) || value.greaterThan(100)) return null;
  return value.toDecimalPlaces(2);
}
