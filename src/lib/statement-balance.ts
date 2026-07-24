import { Prisma } from "@prisma/client";

function sumBalance(
  entries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>,
): Prisma.Decimal {
  return entries
    .reduce(
      (acc, row) => acc.plus(row.debit).minus(row.credit),
      new Prisma.Decimal(0),
    )
    .toDecimalPlaces(2);
}

/**
 * Statement balance: always from *all* ledger entries.
 * Period rows may be filtered separately for the table body.
 */
export function statementBalances(input: {
  allEntries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>;
  periodEntries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>;
  creditLimit: Prisma.Decimal;
}): {
  balance: Prisma.Decimal;
  periodNet: Prisma.Decimal;
  creditUsedPct: number | null;
} {
  const balance = sumBalance(input.allEntries);
  const periodNet = sumBalance(input.periodEntries);
  const limit = input.creditLimit;
  const creditUsedPct = limit.greaterThan(0)
    ? Math.min(
        100,
        Math.round(
          (Math.max(balance.toNumber(), 0) / limit.toNumber()) * 100,
        ),
      )
    : null;
  return { balance, periodNet, creditUsedPct };
}

/** Inclusive end-of-day for a YYYY-MM-DD (or ISO date) query param. */
export function endOfDayInclusive(dateInput: string): Date | null {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim()) ||
    (d.getHours() === 0 &&
      d.getMinutes() === 0 &&
      d.getSeconds() === 0 &&
      d.getMilliseconds() === 0)
  ) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

export function startOfDay(dateInput: string): Date | null {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}
