import { cn } from "@/lib/utils";

type MoneyValueProps = {
  amount: number | string;
  currency?: string;
  className?: string;
};

export function MoneyValue({ className }: MoneyValueProps) {
  return (
    <span
      className={cn("font-data tabular-nums text-ink-900", className)}
      dir="ltr"
    >
      —
    </span>
  );
}
