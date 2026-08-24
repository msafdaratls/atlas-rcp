"use client";

import type { LabelEvalDomain } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RequestNumber } from "@/components/atlas/request-number";
import { SlaMeter } from "@/components/atlas/sla-meter";
import { cn } from "@/lib/utils";
import { startLabelAssessment } from "@/server/label-eval/actions";
import type { NeedsEvaluationRow } from "@/server/label-eval/queries";

type Props = {
  rows: NeedsEvaluationRow[];
  domain: LabelEvalDomain;
};

export function NeedsEvaluationTable({ rows, domain }: Props) {
  const t = useTranslations("labelEval.queue");
  const tErrors = useTranslations("labelEval.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const basePath = domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";

  function start(requestItemId: string) {
    startTransition(async () => {
      const result = await startLabelAssessment({ requestItemId, domain });
      if (!result.ok) {
        const [key, detail] = result.error.split(":");
        // A run already exists for this item. concurrency.ts's stated intent
        // is that "the reviewer resumes the existing run instead of creating
        // a duplicate", and the action already returns that run's id — but
        // the id used to be split off and thrown away, so the queue row just
        // raised an error every time and offered no way through. Open the
        // existing run instead.
        if (key === "IN_FLIGHT" && detail) {
          toast.info(tErrors("IN_FLIGHT"));
          router.push(`/${locale}/admin/label-evaluator/${basePath}/${detail}`);
          return;
        }
        toast.error(tErrors((key ?? "START_FAILED") as "START_FAILED"));
        return;
      }
      router.push(`/${locale}/admin/label-evaluator/${basePath}/${result.data.assessmentId}`);
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-alt/60 text-xs text-ink-500">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t("columns.request")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("columns.product")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("columns.client")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("columns.sla")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("columns.submission")}</th>
            <th className="px-3 py-2 text-end font-medium">{t("columns.action")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.requestItemId} className="hover:bg-surface-alt/30">
              <td className="px-3 py-2">
                <RequestNumber value={row.requestNo} />
              </td>
              <td className="px-3 py-2 text-ink-800">
                {isAr ? row.productNameAr || row.productNameEn : row.productNameEn || row.productNameAr}
              </td>
              <td className="px-3 py-2 text-ink-700">
                {isAr ? row.organisationNameAr : row.organisationNameEn}
              </td>
              <td className="px-3 py-2">
                <SlaMeter dueAt={row.slaDueAt} state="ASSESSMENT_RUNNING" />
              </td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    row.isResubmission
                      ? "border-state-warn/30 bg-state-warn/10 text-state-warn"
                      : "border-line bg-surface-alt text-ink-600",
                  )}
                >
                  {row.isResubmission ? t("badge.resubmission") : t("badge.firstSubmission")}
                </span>
              </td>
              <td className="px-3 py-2 text-end">
                <Button size="sm" disabled={pending} onClick={() => start(row.requestItemId)}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {t("startEvaluation")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
