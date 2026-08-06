"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeAssessment,
  type AssessmentDecision,
  type AssessmentState,
  type CheckSet,
  type Verdict,
} from "@/lib/assessment";
import { saveTechnicalReviewChecklist } from "@/server/admin/actions";
import { CheckCircle2, CircleSlash, Loader2, Save, XCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  requestId: string;
  checkSets: CheckSet[];
  initial: AssessmentState;
  editable: boolean;
};

const VERDICT_META: Record<
  Verdict,
  { icon: typeof CheckCircle2; on: string; off: string }
> = {
  COMPLIANT: {
    icon: CheckCircle2,
    on: "bg-state-ok text-white border-state-ok",
    off: "text-state-ok border-state-ok/40 hover:bg-state-ok/10",
  },
  NON_COMPLIANT: {
    icon: XCircle,
    on: "bg-state-bad text-white border-state-bad",
    off: "text-state-bad border-state-bad/40 hover:bg-state-bad/10",
  },
  NA: {
    icon: CircleSlash,
    on: "bg-ink-500 text-white border-ink-500",
    off: "text-ink-500 border-line hover:bg-surface-alt",
  },
};

const DECISION_TONE: Record<AssessmentDecision, string> = {
  ACCEPTED: "bg-state-ok/12 text-state-ok border-state-ok/30",
  ACCEPTED_WITH_REMARKS: "bg-state-warn/12 text-state-warn border-state-warn/30",
  REJECTED: "bg-state-bad/12 text-state-bad border-state-bad/30",
  INCOMPLETE: "bg-surface-alt text-ink-500 border-line",
};

/**
 * Doc's Technical Review meta-checklist (was the evaluation report reviewed,
 * were standards verified, etc.) — request-level, sourced from the single
 * global TechnicalReviewChecklist definition, gating TECHNICAL_REVIEW ->
 * DECISION until every item has a verdict. Distinct from AssessmentPanel,
 * which scores a per-service product-compliance checklist.
 */
export function TechnicalReviewChecklistPanel({
  requestId,
  checkSets,
  initial,
  editable,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.technicalReviewChecklist");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(
    initial.verdicts ?? {},
  );
  const [dirty, setDirty] = useState(false);

  const summary = useMemo(
    () => computeAssessment(checkSets, { verdicts }),
    [checkSets, verdicts],
  );

  function setVerdict(code: string, v: Verdict) {
    if (!editable) return;
    setVerdicts((prev) => {
      const next = { ...prev };
      if (next[code] === v) delete next[code];
      else next[code] = v;
      return next;
    });
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await saveTechnicalReviewChecklist({
          requestId,
          verdicts,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
          return;
        }
        setDirty(false);
        toast.success(t("saved"));
      } catch {
        // Network/transport failure (e.g. a 503) never reaches the
        // `{ok:false}` branch above — without this, the save silently
        // fails with no feedback and "Unsaved changes" is the only clue.
        toast.error(t("errors.SAVE_FAILED"));
      }
    });
  }

  const items = checkSets.flatMap((s) => s.items);
  if (items.length === 0) return null;

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{t("title")}</h2>
          <p className="text-xs text-ink-500">{t("subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            DECISION_TONE[summary.recommendation],
          )}
        >
          {t(`status.${summary.recommendation}`)}
        </span>
      </div>

      <p className="text-xs text-ink-600">
        {t("progress", { done: summary.assessed, total: summary.total })}
      </p>

      <ul className="divide-y divide-line rounded-md border border-line">
        {items.map((item, idx) => (
          <li
            key={item.code}
            className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
          >
            <p className="min-w-0 flex-1 text-sm text-ink-900">
              <span className="font-data text-xs text-ink-400">{idx + 1}.</span>{" "}
              {isAr ? item.titleAr : item.titleEn}
            </p>
            <div className="flex shrink-0 gap-1">
              {(["COMPLIANT", "NON_COMPLIANT", "NA"] as Verdict[]).map((v) => {
                const meta = VERDICT_META[v];
                const Icon = meta.icon;
                const active = verdicts[item.code] === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={!editable}
                    onClick={() => setVerdict(item.code, v)}
                    title={t(`verdict.${v}`)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                      active ? meta.on : meta.off,
                    )}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{t(`verdict.${v}`)}</span>
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      {editable ? (
        <div className="flex items-center justify-end gap-3">
          {dirty ? (
            <span className="text-xs text-state-warn">{t("unsaved")}</span>
          ) : null}
          <Button type="button" size="sm" disabled={pending || !dirty} onClick={save}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t("save")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-ink-500">{t("readOnly")}</p>
      )}
    </section>
  );
}
