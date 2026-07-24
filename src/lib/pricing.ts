import { Prisma } from "@prisma/client";

export type MoneyBreakdown = {
  subtotal: Prisma.Decimal;
  discount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  total: Prisma.Decimal;
  vatRate: Prisma.Decimal;
};

export function computePriceBreakdown(input: {
  basePrice: Prisma.Decimal | number | string;
  discount?: Prisma.Decimal | number | string;
  vatRate?: Prisma.Decimal | number | string;
}): MoneyBreakdown {
  const subtotal = new Prisma.Decimal(input.basePrice);
  const discount = new Prisma.Decimal(input.discount ?? 0);
  const vatRate = new Prisma.Decimal(input.vatRate ?? 0.15);
  const clampedDiscount = Prisma.Decimal.min(discount, subtotal);
  const taxable = subtotal.minus(clampedDiscount);
  const vatAmount = taxable.mul(vatRate).toDecimalPlaces(2);
  const total = taxable.plus(vatAmount).toDecimalPlaces(2);
  return {
    subtotal: subtotal.toDecimalPlaces(2),
    discount: clampedDiscount.toDecimalPlaces(2),
    vatAmount,
    total,
    vatRate,
  };
}

export function toNumber(value: Prisma.Decimal | number | string): number {
  return new Prisma.Decimal(value).toNumber();
}

/**
 * Zod-friendly money input: accepts string or number, rejects NaN/Infinity,
 * and yields a 2dp Prisma.Decimal (no float persistence).
 */
export function parseMoneyInput(
  value: unknown,
  opts: { min?: number; max?: number } = {},
): Prisma.Decimal | null {
  try {
    if (value === null || value === undefined || value === "") return null;
    const d = new Prisma.Decimal(String(value).trim());
    if (d.isNaN()) return null;
    const min = opts.min ?? 0;
    const max = opts.max ?? Number.POSITIVE_INFINITY;
    if (d.lt(min) || d.gt(max)) return null;
    return d.toDecimalPlaces(2);
  } catch {
    return null;
  }
}
