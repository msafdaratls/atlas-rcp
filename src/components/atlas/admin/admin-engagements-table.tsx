"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { APP_TIME_ZONE } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EngagementListItem } from "@/server/admin/engagements";

const STATUS_TONE: Record<EngagementListItem["status"], string> = {
  ACTIVE: "bg-state-ok/12 text-state-ok border-state-ok/30",
  PAUSED: "bg-state-warn/12 text-state-warn border-state-warn/30",
  CLOSED: "bg-surface-alt text-ink-600 border-line",
};

export function AdminEngagementsTable({
  rows,
  locale,
}: {
  rows: EngagementListItem[];
  locale: string;
}) {
  const t = useTranslations("adminOps.engagements");

  if (rows.length === 0) {
    return <p className="text-sm text-ink-500">{t("empty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
          <tr>
            <th className="px-3 py-2 text-start">{t("columns.client")}</th>
            <th className="px-3 py-2 text-start">{t("columns.service")}</th>
            <th className="px-3 py-2 text-start">{t("columns.status")}</th>
            <th className="px-3 py-2 text-start">{t("columns.requests")}</th>
            <th className="px-3 py-2 text-start">{t("columns.started")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-surface-alt/50">
              <td className="px-3 py-2">
                <Link
                  href={`/${locale}/admin/engagements/${r.id}`}
                  className="font-medium text-atlas-green hover:underline"
                >
                  {locale === "ar" ? r.organisation.nameAr : r.organisation.nameEn}
                </Link>
              </td>
              <td className="px-3 py-2 text-ink-700">
                {locale === "ar" ? r.serviceItem.nameAr : r.serviceItem.nameEn}
              </td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    STATUS_TONE[r.status],
                  )}
                >
                  {t(`status.${r.status}`)}
                </span>
              </td>
              <td className="px-3 py-2 text-ink-700">{r.requestCount}</td>
              <td className="px-3 py-2 text-ink-500" dir="ltr">
                {new Date(r.startedAt).toLocaleDateString(locale, {
                  timeZone: APP_TIME_ZONE,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
