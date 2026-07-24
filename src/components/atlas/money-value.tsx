"use client";

import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

type MoneyValueProps = {
  amount: number | string;
  currency?: string;
  className?: string;
};

export function MoneyValue({
  amount,
  currency = "SAR",
  className,
}: MoneyValueProps) {
  const locale = useLocale();
  const value = typeof amount === "string" ? Number(amount) : amount;

  const formatted = new Intl.NumberFormat(
    locale === "ar" ? "ar-SA" : "en-GB",
    {
      style: "currency",
      currency,
      currencyDisplay: "code",
    },
  ).format(Number.isFinite(value) ? value : 0);

  return (
    <span
      className={cn("font-data tabular-nums text-ink-900", className)}
      dir="ltr"
    >
      {formatted}
    </span>
  );
}
