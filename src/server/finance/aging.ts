import { Prisma } from "@prisma/client";
import { toNumber } from "@/lib/pricing";

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";

export type AgingSummary = Record<AgingBucket, number>;

export function emptyAging(): AgingSummary {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/**
 * Age an open invoice balance by days past due.
 * dueAt = issuedAt + paymentTermsDays (or issuedAt when terms are 0 / cash).
 */
export function bucketForDue(dueAt: Date, now = new Date()): AgingBucket {
  const ms = now.getTime() - dueAt.getTime();
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export function accumulateAging(
  summary: AgingSummary,
  bucket: AgingBucket,
  amount: Prisma.Decimal | number,
): void {
  const next = new Prisma.Decimal(summary[bucket])
    .plus(amount)
    .toDecimalPlaces(2);
  summary[bucket] = toNumber(next);
}

export type LedgerRowView = {
  id: string;
  entryDate: string;
  descriptionEn: string;
  descriptionAr: string;
  referenceType: string;
  referenceId: string;
  debit: number;
  credit: number;
  runningBalance: number;
  linkHref: string | null;
};

export function withRunningBalance(
  entries: Array<{
    id: string;
    entryDate: Date;
    descriptionEn: string;
    descriptionAr: string;
    referenceType: string;
    referenceId: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
  }>,
  localePrefix: "client" | "admin",
  openingBalance: Prisma.Decimal | number = 0,
): LedgerRowView[] {
  let running = new Prisma.Decimal(openingBalance);
  return entries.map((row) => {
    running = running.plus(row.debit).minus(row.credit);
    return {
      id: row.id,
      entryDate: row.entryDate.toISOString(),
      descriptionEn: row.descriptionEn,
      descriptionAr: row.descriptionAr,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      debit: toNumber(row.debit),
      credit: toNumber(row.credit),
      runningBalance: toNumber(running),
      linkHref: referenceLink(row.referenceType, row.referenceId, localePrefix),
    };
  });
}

function referenceLink(
  referenceType: string,
  referenceId: string,
  localePrefix: "client" | "admin",
): string | null {
  if (referenceType === "Request") {
    return `/${localePrefix}/requests/${referenceId}`;
  }
  if (localePrefix === "admin") {
    // Admin has finance, not statement.
    if (
      referenceType === "Invoice" ||
      referenceType === "Payment" ||
      referenceType === "LedgerEntry"
    ) {
      return `/admin/finance`;
    }
    return null;
  }
  if (referenceType === "Invoice") {
    return `/client/statement?invoice=${referenceId}`;
  }
  if (referenceType === "Payment") {
    return `/client/statement?payment=${referenceId}`;
  }
  return null;
}
