import { Prisma } from "@prisma/client";

export type AllocationPlanLine = { invoiceId: string; amount: Prisma.Decimal };

/**
 * FIFO allocation plan for a payment with no explicit per-invoice
 * allocations: pays down the oldest-due open invoice first, then the next,
 * until the payment is exhausted or every invoice is fully covered.
 *
 * `openInvoices` must already be sorted oldest-due-first (dueAt asc, then
 * createdAt asc) — this function only walks the list in the order given, it
 * doesn't sort. Pure/no I/O so the allocation math itself (the part
 * `confirmPayment` actually relies on for correctness) can be unit tested
 * without a database.
 */
export function planFifoAllocation(
  paymentAmount: Prisma.Decimal,
  openInvoices: Array<{
    id: string;
    total: Prisma.Decimal;
    allocations: Array<{ amount: Prisma.Decimal }>;
  }>,
): AllocationPlanLine[] {
  let remaining = paymentAmount;
  const plan: AllocationPlanLine[] = [];
  for (const inv of openInvoices) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const paid = inv.allocations.reduce(
      (a, x) => a.plus(x.amount),
      new Prisma.Decimal(0),
    );
    const open = Prisma.Decimal.max(inv.total.minus(paid), new Prisma.Decimal(0));
    const take = Prisma.Decimal.min(open, remaining).toDecimalPlaces(2);
    if (take.greaterThan(0)) {
      plan.push({ invoiceId: inv.id, amount: take });
      remaining = remaining.minus(take).toDecimalPlaces(2);
    }
  }
  return plan;
}
