"use client";

import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATE_TONE_CLASS, type StateTone } from "@/lib/request-state";
import { cn } from "@/lib/utils";
import { setCouponStatus } from "@/server/admin/actions";
import type { AdminCouponItem } from "@/server/admin/queries";
import type { CouponStatus } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

const STATUS_TONE: Record<CouponStatus, StateTone> = {
  ACTIVE: "ok",
  PAUSED: "warn",
  EXPIRED: "neutral",
};

type Props = { rows: AdminCouponItem[] };

export function AdminCouponsTable({ rows }: Props) {
  const t = useTranslations("adminOps.coupons");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.nameAr.includes(q),
    );
  }, [rows, query]);

  function handleSetStatus(coupon: AdminCouponItem, status: "ACTIVE" | "PAUSED") {
    setPendingId(coupon.id);
    startTransition(async () => {
      const result = await setCouponStatus({ id: coupon.id, status });
      setPendingId(null);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tCommon("search")}
        className="max-w-xs"
      />

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface-alt px-6 py-10 text-center text-sm text-ink-500">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead className="bg-surface-alt text-start">
              <tr className="border-b border-line">
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.code")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.name")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.value")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.appliesTo")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.clientScope")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.usage")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.valid")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.status")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((coupon) => (
                <tr
                  key={coupon.id}
                  className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                >
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {coupon.code}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink-900">
                      {locale === "ar" ? coupon.nameAr : coupon.nameEn}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 font-data" dir="ltr">
                    {coupon.discountType === "PERCENT" ? (
                      t("percentValue", { value: coupon.value })
                    ) : (
                      <MoneyValue amount={coupon.value} />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {t(`create.appliesToOptions.${coupon.appliesTo}`)}
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {t(`create.clientScopeOptions.${coupon.clientScope}`)}
                  </td>
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {coupon.totalUsageLimit === null
                      ? t("usageUnlimited", { used: coupon.usedCount })
                      : t("usageWithLimit", {
                          used: coupon.usedCount,
                          limit: coupon.totalUsageLimit,
                        })}
                  </td>
                  <td className="px-3 py-2.5 font-data text-xs text-ink-500" dir="ltr">
                    {coupon.validFrom.slice(0, 10)} – {coupon.validTo.slice(0, 10)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                        STATE_TONE_CLASS[STATUS_TONE[coupon.status]],
                      )}
                    >
                      {t(`statusLabels.${coupon.status}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {coupon.status === "EXPIRED" ? (
                      <span className="text-xs text-ink-500">—</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === coupon.id}
                        onClick={() =>
                          handleSetStatus(
                            coupon,
                            coupon.status === "ACTIVE" ? "PAUSED" : "ACTIVE",
                          )
                        }
                      >
                        {pendingId === coupon.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        {coupon.status === "ACTIVE" ? t("pause") : t("activate")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
