import type { LabelEvalDomain } from "@prisma/client";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RequestNumber } from "@/components/atlas/request-number";
import { cn } from "@/lib/utils";
import type { RecentAssessmentRow } from "@/server/label-eval/queries";

type Props = {
  rows: RecentAssessmentRow[];
  domain: LabelEvalDomain;
  locale: string;
};

const IN_FLIGHT: Record<string, boolean> = {
  EXTRACTING: true,
  CLASSIFYING: true,
  AWAITING_REVIEW: true,
  // Waiting on the evaluator, not on a background job — no spinner.
  MANUAL_IN_PROGRESS: false,
};

const STATUS_TONE: Record<string, string> = {
  EXTRACTING: "border-line bg-surface-alt text-ink-600",
  CLASSIFYING: "border-line bg-surface-alt text-ink-600",
  AWAITING_REVIEW: "border-state-warn/40 bg-state-warn/10 text-state-warn",
  MANUAL_IN_PROGRESS: "border-state-warn/40 bg-state-warn/10 text-state-warn",
  ASSESSED: "border-state-ok/40 bg-state-ok/10 text-state-ok",
  ERROR: "border-state-bad/40 bg-state-bad/10 text-state-bad",
  BLOCKED_NO_CATEGORY_MATCH: "border-state-warn/40 bg-state-warn/10 text-state-warn",
};

export async function RecentAssessmentsTable({ rows, domain, locale }: Props) {
  const t = await getTranslations("labelEval.queue.recent");
  const basePath = domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-ink-900">{t("title")}</h2>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-alt/60 text-xs text-ink-500">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("columns.request")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.client")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.method")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.status")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.updated")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("columns.action")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-alt/30">
                <td className="px-3 py-2">
                  <RequestNumber value={row.requestNo} />
                </td>
                <td className="px-3 py-2 text-ink-700">{row.organisationName}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center rounded-full border border-line bg-surface-alt px-2 py-0.5 text-xs font-medium text-ink-600">
                    {t(`method.${row.method}` as "method.AI")}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
                      STATUS_TONE[row.status] ?? "border-line bg-surface-alt text-ink-600",
                    )}
                  >
                    {IN_FLIGHT[row.status] ? <Loader2 className="size-3 animate-spin" /> : null}
                    {t(`status.${row.status}` as "status.ASSESSED")}
                  </span>
                  {row.promotedAt ? (
                    <span className="ms-1.5 text-[10px] text-ink-500">{t("promoted")}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 font-data text-xs text-ink-500">
                  {new Date(row.updatedAt).toLocaleString(locale)}
                </td>
                <td className="px-3 py-2 text-end">
                  <Link
                    href={
                      row.method === "MANUAL"
                        ? `/${locale}/admin/label-evaluator/manual/${row.id}`
                        : `/${locale}/admin/label-evaluator/${basePath}/${row.id}`
                    }
                    className="text-xs font-medium text-atlas-green hover:underline"
                  >
                    {t("open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
