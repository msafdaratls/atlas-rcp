"use client";

import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STATE_TONE_CLASS } from "@/lib/request-state";
import { cn } from "@/lib/utils";
import { toggleServiceItemActive } from "@/server/admin/actions";
import type { AdminCatalogueItem } from "@/server/admin/queries";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Props = { rows: AdminCatalogueItem[] };

export function AdminCatalogueTable({ rows }: Props) {
  const t = useTranslations("adminOps.catalogue");
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
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.nameAr.includes(q),
    );
  }, [rows, query]);

  function handleToggle(item: AdminCatalogueItem) {
    setPendingId(item.id);
    startTransition(async () => {
      const result = await toggleServiceItemActive({
        id: item.id,
        active: !item.active,
      });
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
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead className="bg-surface-alt text-start">
              <tr className="border-b border-line">
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.code")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.name")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.price")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.sla")}
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
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                >
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {item.code}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink-900">
                      {locale === "ar" ? item.nameAr : item.nameEn}
                    </p>
                    <p className="text-xs text-ink-500">
                      {locale === "ar"
                        ? item.subCategoryNameAr
                        : item.subCategoryNameEn}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <MoneyValue amount={item.basePrice} />
                  </td>
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {item.slaHours}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                        STATE_TONE_CLASS[item.active ? "ok" : "neutral"],
                      )}
                    >
                      {item.active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={pendingId === item.id}
                      onClick={() => handleToggle(item)}
                    >
                      {pendingId === item.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      {t("toggle")}
                    </Button>
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
