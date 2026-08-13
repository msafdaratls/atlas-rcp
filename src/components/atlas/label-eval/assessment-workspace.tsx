"use client";

import type { LabelEvalDomain } from "@prisma/client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FlaskConical,
  Loader2,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { LABEL_FIELD_DEFS, mandatoryFieldKeys } from "@/server/label-eval/fields";
import {
  confirmFieldsAndRunAssessment,
  getLabelAssessmentStatus,
  overrideItemVerdict,
  promoteToOfficialChecklist,
  reclassifyAssessment,
  updateExtractedField,
} from "@/server/label-eval/actions";
import type { AssessmentDetail, AssessmentDetailVerdict } from "@/server/label-eval/queries";

type Props = { detail: AssessmentDetail; domain: LabelEvalDomain };

const VERDICT_META: Record<string, { icon: typeof CheckCircle2; tone: string; labelKey: string }> = {
  COMPLIANT: { icon: CheckCircle2, tone: "text-state-ok border-state-ok/40 bg-state-ok/10", labelKey: "verdict.COMPLIANT" },
  NON_COMPLIANT: { icon: XCircle, tone: "text-state-bad border-state-bad/40 bg-state-bad/10", labelKey: "verdict.NON_COMPLIANT" },
  NA: { icon: CircleHelp, tone: "text-ink-500 border-line bg-surface-alt", labelKey: "verdict.NA" },
  NEEDS_REVIEW: { icon: AlertTriangle, tone: "text-state-warn border-state-warn/40 bg-state-warn/10", labelKey: "verdict.NEEDS_REVIEW" },
  REQUIRES_ADDITIONAL_DATA: { icon: FlaskConical, tone: "text-ink-600 border-line bg-surface-alt", labelKey: "verdict.REQUIRES_ADDITIONAL_DATA" },
};

const FINAL_VERDICT_TONE: Record<string, string> = {
  accepted: "bg-state-ok/12 text-state-ok border-state-ok/30",
  accepted_with_remarks: "bg-state-warn/12 text-state-warn border-state-warn/30",
  rejected: "bg-state-bad/12 text-state-bad border-state-bad/30",
  incomplete: "bg-surface-alt text-ink-500 border-line",
  // Cosmetics uses a different finalVerdict vocabulary (design doc §8.2 — DECISION PENDING).
  compliant: "bg-state-ok/12 text-state-ok border-state-ok/30",
  non_compliant: "bg-state-bad/12 text-state-bad border-state-bad/30",
};

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function AssessmentWorkspace({ detail, domain }: Props) {
  const t = useTranslations("labelEval.workspace");
  const tErrors = useTranslations("labelEval.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();

  // Poll while extraction/classification is still running async (design doc §5 — never block on it).
  const statusRef = useRef(detail.status);
  statusRef.current = detail.status;
  useEffect(() => {
    if (detail.status !== "EXTRACTING" && detail.status !== "CLASSIFYING") return;
    const interval = setInterval(async () => {
      const latest = await getLabelAssessmentStatus(detail.id);
      if (latest && latest.status !== statusRef.current) router.refresh();
    }, 3000);
    return () => clearInterval(interval);
  }, [detail.status, detail.id, router]);

  if (detail.status === "EXTRACTING") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-alt/40 p-6">
        <Loader2 className="size-5 animate-spin text-atlas-green" />
        <div>
          <p className="text-sm font-medium text-ink-900">{t("extracting.title")}</p>
          <p className="text-xs text-ink-500">{t("extracting.description")}</p>
        </div>
      </div>
    );
  }

  if (detail.status === "CLASSIFYING") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-alt/40 p-6">
        <Loader2 className="size-5 animate-spin text-atlas-green" />
        <div>
          <p className="text-sm font-medium text-ink-900">{t("classifying.title")}</p>
          <p className="text-xs text-ink-500">{t("classifying.description")}</p>
        </div>
      </div>
    );
  }

  if (detail.status === "ERROR") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-state-bad/30 bg-state-bad/10 p-6">
        <XCircle className="size-5 text-state-bad" />
        <p className="text-sm text-state-bad">{t("errorState")}</p>
      </div>
    );
  }

  if (detail.status === "AWAITING_REVIEW") {
    return <VerificationGate detail={detail} domain={domain} t={t} tErrors={tErrors} isAr={isAr} router={router} />;
  }

  if (detail.status === "BLOCKED_NO_CATEGORY_MATCH") {
    return <BlockedNoCategoryMatch detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} />;
  }

  return <AssessedView detail={detail} domain={domain} t={t} tErrors={tErrors} isAr={isAr} router={router} />;
}

// ─── Step: Cosmetics classifier refused to guess (design doc §0.1/§1.4) ────

function BlockedNoCategoryMatch({
  detail,
  t,
  tErrors,
  isAr,
  router,
}: {
  detail: AssessmentDetail;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  isAr: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-state-warn/30 bg-state-warn/10 p-4">
        <p className="text-sm font-semibold text-state-warn">{t("blockedTitle")}</p>
        <p className="mt-1 text-sm text-ink-700">{t("blockedDescription")}</p>
        {detail.classification?.rationale ? (
          <p className="mt-2 rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink-600">
            {detail.classification.rationale}
          </p>
        ) : null}
      </div>
      <ReclassifyPicker detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} />
    </div>
  );
}

function ReclassifyPicker({
  detail,
  t,
  tErrors,
  isAr,
  router,
}: {
  detail: AssessmentDetail;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  isAr: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  function reclassify(categoryCode: string) {
    startTransition(async () => {
      const result = await reclassifyAssessment({ assessmentId: detail.id, categoryCode });
      if (!result.ok) {
        toast.error(tErrors(result.error as "RUN_FAILED"));
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (detail.availableCategories.length === 0) {
    return <p className="text-xs text-ink-500">{t("noCategoriesAvailable")}</p>;
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t("reclassify")}
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="mb-2 text-xs text-ink-500">{t("reclassifyHint")}</p>
      <div className="flex flex-wrap gap-1.5">
        {detail.availableCategories.map((c) => (
          <button
            key={c.code}
            type="button"
            disabled={pending}
            onClick={() => reclassify(c.code)}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-atlas-green hover:bg-atlas-green-tint"
          >
            {isAr ? c.nameAr : c.nameEn}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step: Verification gate ────────────────────────────────────────────────

function VerificationGate({
  detail,
  domain,
  t,
  tErrors,
  isAr,
  router,
}: {
  detail: AssessmentDetail;
  domain: LabelEvalDomain;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  isAr: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const fieldDefs = LABEL_FIELD_DEFS[domain];
  const byKey = useMemo(() => new Map(detail.fields.map((f) => [f.fieldKey, f])), [detail.fields]);
  const [pending, startTransition] = useTransition();
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const missing = mandatoryFieldKeys(domain).filter((def) => {
    const f = byKey.get(def.key);
    return !f?.confirmedAt || !(f.valueEn?.trim() || f.valueAr?.trim());
  });

  function saveField(fieldKey: string, valueEn: string, valueAr: string) {
    setSavingKey(fieldKey);
    startTransition(async () => {
      const result = await updateExtractedField({ assessmentId: detail.id, fieldKey, valueEn, valueAr });
      setSavingKey(null);
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      router.refresh();
    });
  }

  function confirmAndRun() {
    startTransition(async () => {
      const result = await confirmFieldsAndRunAssessment(detail.id);
      if (!result.ok) {
        if (result.error.startsWith("MISSING_FIELDS")) {
          toast.error(t("missingFieldsToast"));
        } else {
          toast.error(tErrors(result.error.split(":")[0] as "RUN_FAILED"));
        }
        return;
      }
      toast.success(t("assessmentComplete"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {missing.length > 0 ? (
        <div className="rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
          <p className="font-medium">{t("missingBanner")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((m) => (
              <span key={m.key} className="rounded-full border border-state-warn/40 bg-surface px-2 py-0.5 text-xs">
                {isAr ? m.labelAr : m.labelEn}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-state-ok/30 bg-state-ok/10 p-3 text-sm text-state-ok">
          {t("readyBanner")}
        </div>
      )}

      <div className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-900">{t("extractedDataTitle")}</h2>
          <p className="text-xs text-ink-500">{t("extractedDataSubtitle")}</p>
        </div>
        <div className="divide-y divide-line">
          {fieldDefs.map((def) => {
            const f = byKey.get(def.key);
            return (
              <FieldRow
                key={def.key}
                fieldKey={def.key}
                labelEn={def.labelEn}
                labelAr={def.labelAr}
                bilingual={def.bilingual}
                mandatory={def.mandatory}
                valueEn={f?.valueEn ?? ""}
                valueAr={f?.valueAr ?? ""}
                needsReview={f?.needsReview ?? false}
                confirmed={!!f?.confirmedAt}
                sourceEngine={f?.sourceEngine ?? "manual"}
                isAr={isAr}
                saving={savingKey === def.key}
                onSave={(en, ar) => saveField(def.key, en, ar)}
                t={t}
              />
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={pending || missing.length > 0} onClick={confirmAndRun}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("confirmAndContinue")}
        </Button>
      </div>
    </div>
  );
}

function FieldRow({
  fieldKey,
  labelEn,
  labelAr,
  bilingual,
  mandatory,
  valueEn,
  valueAr,
  needsReview,
  confirmed,
  sourceEngine,
  isAr,
  saving,
  onSave,
  t,
}: {
  fieldKey: string;
  labelEn: string;
  labelAr: string;
  bilingual: boolean;
  mandatory: boolean;
  valueEn: string;
  valueAr: string;
  needsReview: boolean;
  confirmed: boolean;
  sourceEngine: string;
  isAr: boolean;
  saving: boolean;
  onSave: (en: string, ar: string) => void;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
}) {
  const [en, setEn] = useState(valueEn);
  const [ar, setAr] = useState(valueAr);
  const dirty = en !== valueEn || ar !== valueAr;
  const isLong = fieldKey === "full_label_text" || fieldKey === "warnings" || fieldKey === "ingredients_list" || fieldKey === "nutrition_table";
  const Field = isLong ? Textarea : Input;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
      <div className="w-56 shrink-0">
        <p className="text-sm font-medium text-ink-800">
          {isAr ? labelAr : labelEn}
          {mandatory ? <span className="text-state-bad"> *</span> : null}
        </p>
        {needsReview && !confirmed ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-state-warn/40 bg-state-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-state-warn">
            {t("needsReview")}
          </span>
        ) : confirmed ? (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-state-ok/40 bg-state-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-state-ok">
            {t("confirmed")} · {sourceEngine}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
        <Field
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder={t("englishPlaceholder")}
          dir="ltr"
          className="flex-1"
        />
        {bilingual ? (
          <Field
            value={ar}
            onChange={(e) => setAr(e.target.value)}
            placeholder={t("arabicPlaceholder")}
            dir="rtl"
            className="flex-1"
          />
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty || saving}
        onClick={() => onSave(en, ar)}
        className="shrink-0"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : t("save")}
      </Button>
    </div>
  );
}

// ─── Step: Assessed — cards + verdict bar ───────────────────────────────────

function AssessedView({
  detail,
  domain,
  t,
  tErrors,
  isAr,
  router,
}: {
  detail: AssessmentDetail;
  domain: LabelEvalDomain;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  isAr: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const sections = useMemo(() => {
    const map = new Map<string, AssessmentDetailVerdict[]>();
    for (const v of detail.verdicts) {
      const key = v.section ?? "?";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(v);
    }
    return [...map.entries()];
  }, [detail.verdicts]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of detail.verdicts) c[v.verdict] = (c[v.verdict] ?? 0) + 1;
    return c;
  }, [detail.verdicts]);

  const [pending, startTransition] = useTransition();

  function promote() {
    startTransition(async () => {
      const result = await promoteToOfficialChecklist(detail.id);
      if (!result.ok) {
        toast.error(tErrors(result.error as "PROMOTE_FAILED"));
        return;
      }
      toast.success(t("promoted", { written: result.data.written, withheld: result.data.withheld }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {domain === "COSMETICS" ? <ClassificationBlock detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} /> : null}

      <div className="rounded-lg border border-line bg-surface-alt/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-ink-600">
            {t("scoreCounts", {
              compliant: counts.COMPLIANT ?? 0,
              nonCompliant: counts.NON_COMPLIANT ?? 0,
              needsReview: counts.NEEDS_REVIEW ?? 0,
              requiresData: counts.REQUIRES_ADDITIONAL_DATA ?? 0,
            })}
          </span>
          {domain === "SFDA_SUPPLEMENTS" ? (
            <span className="font-data text-ink-800">
              {t("overallRate")}: <strong>{pct(detail.overallRate)}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {sections.map(([section, verdicts]) => (
        <SectionCard key={section} section={section} verdicts={verdicts} isAr={isAr} assessmentId={detail.id} t={t} router={router} />
      ))}

      {domain === "COSMETICS" ? <RequiredTestsTable detail={detail} t={t} isAr={isAr} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-semibold",
            FINAL_VERDICT_TONE[detail.finalVerdict ?? "incomplete"],
          )}
        >
          {t(`decision.${detail.finalVerdict ?? "incomplete"}` as "decision.accepted")}
        </span>
        <div className="flex items-center gap-2">
          {domain === "SFDA_SUPPLEMENTS" ? (
            detail.promotedAt ? (
              <span className="text-xs text-ink-500">{t("alreadyPromoted")}</span>
            ) : (
              <Button disabled={pending} onClick={promote}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("promoteButton")}
              </Button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ClassificationBlock({
  detail,
  t,
  tErrors,
  isAr,
  router,
}: {
  detail: AssessmentDetail;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  isAr: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const c = detail.classification;
  const activeCode = c?.overrideCategoryCode ?? c?.detectedCategoryCode ?? null;
  const category = detail.availableCategories.find((cat) => cat.code === activeCode);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{t("classificationTitle")}</h2>
          <p className="mt-1 text-sm text-ink-700">
            {category ? (isAr ? category.nameAr : category.nameEn) : t("noCategoriesAvailable")}
            {c?.overrideCategoryCode ? <span className="ms-2 text-xs text-state-warn">{t("manuallyOverridden")}</span> : null}
          </p>
          {c?.rationale ? <p className="mt-1 text-xs text-ink-500">{c.rationale}</p> : null}
        </div>
      </div>
      <div className="mt-3">
        <ReclassifyPicker detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} />
      </div>
    </div>
  );
}

function RequiredTestsTable({
  detail,
  t,
  isAr,
}: {
  detail: AssessmentDetail;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  isAr: boolean;
}) {
  if (detail.requiredTests.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("requiredTestsTitle", { count: detail.requiredTests.length })}</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-surface-alt/60 text-xs text-ink-500">
          <tr>
            <th className="px-3 py-2 text-start font-medium">{t("requiredTestsColumns.test")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("requiredTestsColumns.reason")}</th>
            <th className="px-3 py-2 text-start font-medium">{t("requiredTestsColumns.rule")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {detail.requiredTests.map((rt) => (
            <tr key={rt.ruleCode}>
              <td className="px-3 py-2 text-ink-800">
                {rt.testCode}
                {rt.mandatory ? <span className="ms-1 text-xs text-state-bad">*</span> : null}
              </td>
              <td className="px-3 py-2 text-ink-600">{(isAr ? rt.reasonAr : rt.reasonEn) ?? "—"}</td>
              <td className="px-3 py-2 font-data text-xs text-ink-500">{rt.ruleCode}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({
  section,
  verdicts,
  isAr,
  assessmentId,
  t,
  router,
}: {
  section: string;
  verdicts: AssessmentDetailVerdict[];
  isAr: boolean;
  assessmentId: string;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(true);
  const compliant = verdicts.filter((v) => v.verdict === "COMPLIANT").length;
  const nonCompliant = verdicts.filter((v) => v.verdict === "NON_COMPLIANT").length;

  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 border-b border-line bg-surface-alt/50 px-3 py-2 text-start"
      >
        <h3 className="text-sm font-semibold text-ink-900">{section}</h3>
        <div className="flex items-center gap-2">
          <span className="font-data text-xs text-ink-500">
            {t("sectionCounts", { compliant, nonCompliant, total: verdicts.length })}
          </span>
          <ChevronDown className={cn("size-4 text-ink-500 transition-transform", open && "rotate-180")} />
        </div>
      </button>
      {open ? (
        <div className="divide-y divide-line">
          {verdicts.map((v) => (
            <VerdictCard key={v.kbRuleId} verdict={v} isAr={isAr} assessmentId={assessmentId} t={t} router={router} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VerdictCard({
  verdict,
  isAr,
  assessmentId,
  t,
  router,
}: {
  verdict: AssessmentDetailVerdict;
  isAr: boolean;
  assessmentId: string;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  router: ReturnType<typeof useRouter>;
}) {
  const meta = VERDICT_META[verdict.verdict] ?? VERDICT_META.NEEDS_REVIEW!;
  const Icon = meta.icon;
  const [overriding, setOverriding] = useState(false);
  const [pending, startTransition] = useTransition();
  const tErrors = useTranslations("labelEval.errors");

  const OPTIONS: string[] = ["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA"];

  function change(newVerdict: string) {
    startTransition(async () => {
      const result = await overrideItemVerdict({
        assessmentId,
        kbRuleId: verdict.kbRuleId,
        expectedPreviousVerdict: verdict.verdict as never,
        newVerdict: newVerdict as never,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error as "OVERRIDE_FAILED"));
        return;
      }
      setOverriding(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-ink-500">{verdict.code}{verdict.standard ? ` · ${verdict.standard}` : ""}</p>
          <p className="text-sm font-medium text-ink-900">{isAr ? verdict.titleAr : verdict.titleEn || verdict.titleAr}</p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", meta.tone)}>
          <Icon className="size-3.5" />
          {t(meta.labelKey as "verdict.COMPLIANT")}
        </span>
      </div>
      {verdict.rationale ? <p className="text-xs text-ink-600">{verdict.rationale}</p> : null}
      {verdict.evidenceText ? (
        <p className="rounded border border-line bg-surface-alt/40 px-2 py-1.5 text-xs text-ink-700">
          {t("evidenceLabel")}: {verdict.evidenceText}
        </p>
      ) : null}
      {verdict.autoOrManual === "manual_override" ? (
        <p className="text-[10px] text-ink-500">{t("manuallyOverridden")}</p>
      ) : null}

      {overriding ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={pending}
              onClick={() => change(opt)}
              className={cn(
                "rounded-full border px-2 py-1 text-xs font-medium transition-colors",
                opt === verdict.verdict
                  ? VERDICT_META[opt]!.tone
                  : "border-line text-ink-600 hover:bg-surface-alt",
              )}
            >
              {t(VERDICT_META[opt]!.labelKey as "verdict.COMPLIANT")}
            </button>
          ))}
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOverriding(true)}>
          {t("changeAssessment")}
        </Button>
      )}
    </div>
  );
}
