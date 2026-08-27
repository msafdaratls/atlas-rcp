"use client";

import { CheckCircle2, FileText, Loader2, PencilLine, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  RequiredTestsTable,
  SectionCard,
} from "@/components/atlas/label-eval/assessment-workspace";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  abandonManualAssessment,
  checkAssessmentClaim,
  completeManualAssessment,
  setManualCategory,
} from "@/server/label-eval/actions";
import type { AssessmentDetail, AssessmentDetailVerdict } from "@/server/label-eval/queries";

type Props = { detail: AssessmentDetail };

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The hand-worked counterpart to AssessmentWorkspace. Same KB checklist, same
 * verdict cards, same override action — nothing is pre-filled and no rule
 * engine, classifier or model ever runs against it. Only rendered while the
 * run is MANUAL_IN_PROGRESS; once completed it becomes an ordinary ASSESSED
 * assessment and the shared workspace takes over, so the promote-to-official-
 * checklist path is identical for both routes.
 */
export function ManualAssessmentWorkspace({ detail }: Props) {
  const t = useTranslations("labelEval.manual");
  const tWorkspace = useTranslations("labelEval.workspace");
  const tErrors = useTranslations("labelEval.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();

  const sections = useMemo(() => {
    const map = new Map<string, AssessmentDetailVerdict[]>();
    for (const v of detail.verdicts) {
      const key = v.section ?? "?";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return [...map.entries()];
  }, [detail.verdicts]);

  const unresolved = detail.verdicts.filter(
    (v) => v.verdict === "NEEDS_REVIEW" || v.verdict === "REQUIRES_ADDITIONAL_DATA",
  ).length;
  const judged = detail.verdicts.length - unresolved;

  // Soft-claim check, same as AssessmentWorkspace does on mount. A manual run
  // legitimately sits in progress for days (see recovery.ts), which makes two
  // reviewers landing on the same one *more* likely here than on an AI run,
  // not less — and applyVerdictOverride only guards the previous value, so
  // two people judging different rules both succeed with no warning.
  const [claim, setClaim] = useState<{ claimed: true } | { claimed: false; claimedByName: string } | null>(null);
  const [takingOver, startTakeOverTransition] = useTransition();
  useEffect(() => {
    let cancelled = false;
    checkAssessmentClaim(detail.id).then((result) => {
      if (!cancelled && result.ok) setClaim(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  function takeOver() {
    startTakeOverTransition(async () => {
      const result = await checkAssessmentClaim(detail.id, { force: true });
      if (result.ok) setClaim(result.data);
    });
  }

  const [abandonPending, startAbandonTransition] = useTransition();
  function abandon() {
    startAbandonTransition(async () => {
      const result = await abandonManualAssessment({ assessmentId: detail.id });
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "SAVE_FAILED"));
        return;
      }
      toast.success(t("abandoned"));
      router.push(
        `/${locale}/admin/label-evaluator/${detail.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}`,
      );
    });
  }

  // Only offered while nothing has been judged — abandonManualAssessment
  // refuses otherwise, and a button that always errors is worse than none.
  const nothingJudged = detail.verdicts.every((v) => v.autoOrManual === "manual_pending");

  const isCosmetics = detail.domain === "COSMETICS";
  const categoryCode = detail.classification?.overrideCategoryCode ?? null;
  const [completePending, startCompleteTransition] = useTransition();

  function complete() {
    startCompleteTransition(async () => {
      const result = await completeManualAssessment({ assessmentId: detail.id });
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "SAVE_FAILED"));
        return;
      }
      toast.success(t("completed"));
      router.refresh();
    });
  }

  // Mirrors completeManualAssessment's own guards, so the button explains
  // what is missing instead of the action rejecting the click.
  const blockedOnCategory = isCosmetics && !categoryCode;
  const canComplete = !blockedOnCategory && unresolved === 0;

  return (
    <div className="space-y-4">
      {claim && !claim.claimed ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
          <span>{tWorkspace("claimedByOther", { name: claim.claimedByName })}</span>
          <Button size="sm" variant="outline" disabled={takingOver} onClick={takeOver}>
            {takingOver ? <Loader2 className="size-4 animate-spin" /> : null}
            {tWorkspace("takeOver")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
        <span className="inline-flex items-center gap-2">
          <PencilLine className="size-4" />
          {t("banner")}
        </span>
        <span className="font-data text-xs">
          {t("progress", { judged, total: detail.verdicts.length })}
        </span>
      </div>

      {detail.documents.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold text-ink-900">{t("documentsTitle")}</h2>
          <p className="mb-2 text-xs text-ink-500">{t("documentsSubtitle")}</p>
          <ul className="space-y-1">
            {detail.documents.map((d) => (
              <li key={d.storageKey}>
                <a
                  href={storageUrl(d.storageKey)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-atlas-green hover:underline"
                >
                  <FileText className="size-4" />
                  {d.fileName}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isCosmetics ? <ManualCategoryCard detail={detail} /> : null}

      {sections.map(([section, verdicts]) => (
        <SectionCard
          key={section}
          section={section}
          verdicts={verdicts}
          isAr={isAr}
          assessmentId={detail.id}
          domain={detail.domain}
          t={tWorkspace}
          router={router}
        />
      ))}

      {isCosmetics ? <RequiredTestsTable detail={detail} t={tWorkspace} isAr={isAr} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <p className="text-xs text-ink-500">
          {blockedOnCategory
            ? t("blockedOnCategory")
            : unresolved > 0
              ? t("blockedOnUnresolved", { count: unresolved })
              : t("readyToComplete")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {nothingJudged ? (
            <Button variant="outline" disabled={abandonPending} onClick={abandon}>
              {abandonPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("abandonButton")}
            </Button>
          ) : null}
        <Button disabled={completePending || !canComplete} onClick={complete}>
          {completePending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {t("completeButton")}
        </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The cosmetics category control for a manual run. Rendered both while the run
 * is in progress and after it is completed: the category drives
 * applyRequiredTests, so a wrong one that is only noticed after completion
 * must still be correctable — and unlike the AI route there is no
 * reclassifyAssessment to fall back on (it re-runs the rule engine, which
 * would erase every hand-typed verdict).
 */
export function ManualCategoryCard({ detail }: Props) {
  const t = useTranslations("labelEval.manual");
  const tErrors = useTranslations("labelEval.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();
  const categoryCode = detail.classification?.overrideCategoryCode ?? null;
  const [categoryDraft, setCategoryDraft] = useState(categoryCode ?? "");
  const [pending, startTransition] = useTransition();

  function saveCategory() {
    if (!categoryDraft) return;
    startTransition(async () => {
      const result = await setManualCategory({
        assessmentId: detail.id,
        categoryCode: categoryDraft,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "SAVE_FAILED"));
        return;
      }
      toast.success(t("categorySaved"));
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink-900">{t("categoryTitle")}</h2>
      <p className="mb-2 text-xs text-ink-500">{t("categorySubtitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={categoryDraft} onValueChange={setCategoryDraft}>
          <SelectTrigger className="w-72 text-sm">
            <SelectValue placeholder={t("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {detail.availableCategories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {isAr ? c.nameAr : c.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !categoryDraft || categoryDraft === categoryCode}
          onClick={saveCategory}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("saveCategory")}
        </Button>
      </div>
    </div>
  );
}
