"use client";

import type { AssessmentMethod, LabelEvalDomain } from "@prisma/client";
import { Loader2, PencilLine, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RequestNumber } from "@/components/atlas/request-number";
import { SlaMeter } from "@/components/atlas/sla-meter";
import { cn } from "@/lib/utils";
import { startLabelAssessment, startManualLabelAssessment } from "@/server/label-eval/actions";
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
  // Per-row, not per-table: with one shared `pending` every button in the
  // queue greyed out while any single row was starting.
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const basePath = domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";

  function workspaceHref(method: AssessmentMethod, assessmentId: string) {
    return method === "MANUAL"
      ? `/${locale}/admin/label-evaluator/manual/${assessmentId}`
      : `/${locale}/admin/label-evaluator/${basePath}/${assessmentId}`;
  }

  function start(requestItemId: string, method: AssessmentMethod) {
    setBusyRow(requestItemId);
    startTransition(async () => {
      const result =
        method === "MANUAL"
          ? await startManualLabelAssessment({ requestItemId, domain })
          : await startLabelAssessment({ requestItemId, domain });
      if (!result.ok) {
        const [key, assessmentId, existingMethod] = result.error.split(":");
        // A run already exists for this item. concurrency.ts's stated intent
        // is that "the reviewer resumes the existing run instead of creating
        // a duplicate", and the action already returns that run's id — so
        // open it rather than raising an error with no way through. The
        // existing run's own method decides the destination, which may not be
        // the route just clicked.
        if (key === "IN_FLIGHT" && assessmentId) {
          toast.info(tErrors("IN_FLIGHT"));
          router.push(workspaceHref((existingMethod as AssessmentMethod) ?? "AI", assessmentId));
          return;
        }
        setBusyRow(null);
        toast.error(tErrors((key ?? "START_FAILED") as "START_FAILED"));
        return;
      }
      router.push(workspaceHref(method, result.data.assessmentId));
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
          {rows.map((row) => {
            const busy = busyRow === row.requestItemId;
            // The route chosen at intake (or later by the Evaluator) is the
            // primary button; the other stays available but secondary. With
            // no choice recorded, neither is privileged.
            const chosen = row.assessmentMethod;
            return (
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
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant={chosen === "MANUAL" ? "outline" : "default"}
                      disabled={busy}
                      onClick={() => start(row.requestItemId, "AI")}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      {t("startAiEvaluation")}
                    </Button>
                    <Button
                      size="sm"
                      variant={chosen === "MANUAL" ? "default" : "outline"}
                      disabled={busy}
                      onClick={() => start(row.requestItemId, "MANUAL")}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <PencilLine className="size-4" />}
                      {t("startManualEvaluation")}
                    </Button>
                  </div>
                  {chosen ? (
                    <p className="mt-1 text-end text-[10px] text-ink-500">
                      {t("chosenMethod", { method: t(`method.${chosen}` as "method.AI") })}
                    </p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
