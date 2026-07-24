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
 * Credit-limit gate for chargeable submits.
 *
 * - When `autoHoldWhenOverLimit` is false → allow.
 * - When limit ≤ 0 and auto-hold is on → block any positive upcoming charge.
 * - Otherwise reject when `balance + upcomingTotal >= creditLimit`.
 */
export function isOverCreditLimit(input: {
  autoHoldWhenOverLimit: boolean;
  creditLimit: Prisma.Decimal;
  balance: Prisma.Decimal;
  upcomingTotal: Prisma.Decimal;
}): boolean {
  if (!input.autoHoldWhenOverLimit) return false;
  const upcoming = Prisma.Decimal.max(
    input.upcomingTotal,
    new Prisma.Decimal(0),
  );
  if (input.creditLimit.lessThanOrEqualTo(0)) {
    return upcoming.greaterThan(0);
  }
  return input.balance
    .plus(upcoming)
    .greaterThanOrEqualTo(input.creditLimit);
}

export function balanceFromEntries(
  entries: Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>,
): Prisma.Decimal {
  return sumBalance(entries);
}
