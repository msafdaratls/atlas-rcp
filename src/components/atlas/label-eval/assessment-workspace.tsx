"use client";

import type { LabelEvalDomain } from "@prisma/client";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  FileQuestion,
  FlaskConical,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { bilingualTitle } from "@/lib/bilingual-title";
import { cn } from "@/lib/utils";
import { LABEL_FIELD_DEFS, mandatoryFieldKeys } from "@/server/label-eval/fields";
import {
  checkAssessmentClaim,
  confirmFieldsAndRunAssessment,
  confirmProposedVerdict,
  getLabelAssessmentStatus,
  overrideItemVerdict,
  previewPromotion,
  promoteToOfficialChecklist,
  reclassifyAssessment,
  reevaluateAssessment,
  retryExtraction,
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
  MISSING: { icon: FileQuestion, tone: "text-state-warn border-state-warn/40 bg-state-warn/10", labelKey: "verdict.MISSING" },
};

const FINAL_VERDICT_TONE: Record<string, string> = {
  accepted: "bg-state-ok/12 text-state-ok border-state-ok/30",
  accepted_with_remarks: "bg-state-warn/12 text-state-warn border-state-warn/30",
  rejected: "bg-state-bad/12 text-state-bad border-state-bad/30",
  incomplete: "bg-surface-alt text-ink-500 border-line",
  // Cosmetics uses the workflow doc's own vocabulary (§13 Final Decision),
  // not SFDA's — Compliant / Conditionally Compliant / Non-Compliant /
  // Requires Review, not Accepted / Accepted with remarks / Rejected / Incomplete.
  compliant: "bg-state-ok/12 text-state-ok border-state-ok/30",
  conditionally_compliant: "bg-state-warn/12 text-state-warn border-state-warn/30",
  non_compliant: "bg-state-bad/12 text-state-bad border-state-bad/30",
  requires_review: "bg-surface-alt text-ink-500 border-line",
};

/**
 * The `claims_detected` field is free text holding every claim the extraction
 * picked off the artwork, one per line or separated by ";" / "|" (both appear
 * in real extractions). Split it so claim items can list them all rather than
 * showing one run-on paragraph. Falls back to the Arabic value when the
 * English one is empty.
 */
function splitClaims(valueEn: string | null, valueAr: string | null): string[] {
  const raw = (valueEn?.trim() || valueAr?.trim()) ?? "";
  if (!raw) return [];
  return raw
    .split(/\r?\n|;|\|/)
    .map((c) => c.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function AssessmentWorkspace({ detail, domain }: Props) {
  const t = useTranslations("labelEval.workspace");
  const tErrors = useTranslations("labelEval.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();

  // Soft-claim check (design doc §13.4): runs once when a reviewer opens
  // this assessment. `claimAssessment` itself already existed but had no
  // call site anywhere in the app — confirmed live, two reviewers could
  // open the same in-progress item with zero warning.
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

  const claimBanner =
    claim && !claim.claimed ? (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
        <span>{t("claimedByOther", { name: claim.claimedByName })}</span>
        <Button size="sm" variant="outline" disabled={takingOver} onClick={takeOver}>
          {takingOver ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("takeOver")}
        </Button>
      </div>
    ) : null;

  // Available at every stage, above whichever stage panel renders below —
  // except while someone else holds the claim: re-evaluating discards their
  // work, so the take-over above has to come first (reevaluateAssessment
  // refuses in that state too).
  const topBar = (
    <>
      {claimBanner}
      {claim && !claim.claimed ? null : <ReevaluateBar
        assessmentId={detail.id}
        method={detail.method}
        className="mb-4"
        t={t}
        tErrors={tErrors}
        router={router}
      />}
    </>
  );

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
      <>
        {topBar}
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-alt/40 p-6">
          <Loader2 className="size-5 animate-spin text-atlas-green" />
          <div>
            <p className="text-sm font-medium text-ink-900">{t("extracting.title")}</p>
            <p className="text-xs text-ink-500">{t("extracting.description")}</p>
          </div>
        </div>
      </>
    );
  }

  if (detail.status === "CLASSIFYING") {
    return (
      <>
        {topBar}
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-alt/40 p-6">
          <Loader2 className="size-5 animate-spin text-atlas-green" />
          <div>
            <p className="text-sm font-medium text-ink-900">{t("classifying.title")}</p>
            <p className="text-xs text-ink-500">{t("classifying.description")}</p>
          </div>
        </div>
      </>
    );
  }

  if (detail.status === "ERROR") {
    return (
      <>
        {topBar}
        <ExtractionErrorPanel detail={detail} t={t} tErrors={tErrors} router={router} />
      </>
    );
  }

  if (detail.status === "AWAITING_REVIEW") {
    return (
      <>
        {topBar}
        <VerificationGate detail={detail} domain={domain} t={t} tErrors={tErrors} isAr={isAr} router={router} />
      </>
    );
  }

  if (detail.status === "BLOCKED_NO_CATEGORY_MATCH") {
    return (
      <>
        {topBar}
        <BlockedNoCategoryMatch detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} />
      </>
    );
  }

  return (
    <>
      {topBar}
      <AssessedView detail={detail} domain={domain} t={t} tErrors={tErrors} isAr={isAr} router={router} />
    </>
  );
}

// ─── Step: extraction dead-lettered — offer a retry, not just a red box ────

/**
 * Re-evaluate, available at every stage of a run (the reset itself is
 * `reevaluateAssessment`). Rendered as a header row above whichever
 * stage panel the workspace is showing, so a reviewer who spots the wrong
 * artwork mid-extraction, or wants the run redone against a newly activated
 * dataset, never has to reach the end of the run first.
 *
 * Always confirms: the reset discards this run's extracted fields, verdicts
 * and manual overrides. Reused by the manual workspace, which resets to a
 * fresh MANUAL_IN_PROGRESS checklist instead of re-extracting.
 */
export function ReevaluateBar({
  assessmentId,
  method,
  className,
  t,
  tErrors,
  router,
}: {
  assessmentId: string;
  method: "AI" | "MANUAL";
  /** Spacing is the caller's: the AI workspace stacks it manually, the manual one sits in a space-y list. */
  className?: string;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  router: ReturnType<typeof useRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function reevaluate() {
    startTransition(async () => {
      const result = await reevaluateAssessment({ assessmentId });
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "REEVALUATE_FAILED"));
        return;
      }
      setOpen(false);
      toast.success(t("reevaluateStarted"));
      // AI runs land back on EXTRACTING, where the existing poll takes over;
      // manual runs land on a freshly seeded checklist.
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center justify-end", className)}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" />
        {t("reevaluate")}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reevaluateConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {method === "MANUAL" ? t("reevaluateConfirmManual") : t("reevaluateConfirmAi")}
            </DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
            {t("reevaluateConfirmWarning")}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              {t("promoteConfirmCancel")}
            </Button>
            <Button disabled={pending} onClick={reevaluate}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("reevaluateConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * ERROR used to be a terminal state in the UI: a red panel and nothing to
 * click, so a run that failed extraction could only be revived by editing
 * the database. That was tolerable while ManualEntryProvider (which cannot
 * fail) was the only configured provider; with a real provider selected via
 * LABEL_EVAL_EXTRACTION_PROVIDER, a transient upstream failure is reachable
 * and must not cost the reviewer their run.
 */
function ExtractionErrorPanel({
  detail,
  t,
  tErrors,
  router,
}: {
  detail: AssessmentDetail;
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  tErrors: ReturnType<typeof useTranslations<"labelEval.errors">>;
  router: ReturnType<typeof useRouter>;
}) {
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryExtraction({ assessmentId: detail.id });
      if (!result.ok) {
        toast.error(tErrors(result.error as "RETRY_FAILED"));
        return;
      }
      // Back to EXTRACTING — the extracting panel's existing poll takes over.
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-state-bad/30 bg-state-bad/10 p-6">
      <div className="flex items-start gap-3">
        <XCircle className="mt-0.5 size-5 shrink-0 text-state-bad" />
        <div>
          <p className="text-sm font-medium text-state-bad">{t("errorState")}</p>
          <p className="mt-1 text-xs text-ink-600">{t("errorStateHint")}</p>
        </div>
      </div>
      <Button variant="outline" className="mt-4" disabled={pending} onClick={retry}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("retryExtraction")}
      </Button>
    </div>
  );
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

  // Optimistic overlay: a successful save confirms a field immediately, but
  // `detail` only reflects that once router.refresh()'s server round-trip
  // completes. Without this, the "Needs review" badge and the missing-
  // fields gate both stayed stale until a manual page reload (confirmed
  // live). Keyed by fieldKey; cleared implicitly whenever `detail.fields`
  // is regenerated with confirmedAt already set for that key.
  const [justSaved, setJustSaved] = useState<Record<string, { valueEn: string; valueAr: string }>>({});

  function effectiveField(key: string) {
    const base = byKey.get(key);
    const saved = justSaved[key];
    if (!saved) return base;
    return { ...base, valueEn: saved.valueEn, valueAr: saved.valueAr, confirmedAt: base?.confirmedAt ?? "optimistic" };
  }

  const missing = mandatoryFieldKeys(domain).filter((def) => {
    const f = effectiveField(def.key);
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
      setJustSaved((prev) => ({ ...prev, [fieldKey]: { valueEn, valueAr } }));
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
            const f = effectiveField(def.key);
            const blocking = missing.some((m) => m.key === def.key);
            return (
              <FieldRow
                key={def.key}
                fieldKey={def.key}
                blocking={blocking}
                labelEn={def.labelEn}
                labelAr={def.labelAr}
                bilingual={def.bilingual}
                mandatory={def.mandatory}
                valueEn={f?.valueEn ?? ""}
                valueAr={f?.valueAr ?? ""}
                needsReview={f?.needsReview ?? false}
                confirmed={!!f?.confirmedAt}
                sourceEngine={f?.sourceEngine ?? "manual"}
                originalMachineValue={f?.originalMachineValue ?? null}
                confirmedByName={f?.confirmedByName ?? null}
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
  blocking,
  labelEn,
  labelAr,
  bilingual,
  mandatory,
  valueEn,
  valueAr,
  needsReview,
  confirmed,
  sourceEngine,
  originalMachineValue,
  confirmedByName,
  isAr,
  saving,
  onSave,
  t,
}: {
  fieldKey: string;
  blocking: boolean;
  labelEn: string;
  labelAr: string;
  bilingual: boolean;
  mandatory: boolean;
  valueEn: string;
  valueAr: string;
  needsReview: boolean;
  confirmed: boolean;
  sourceEngine: string;
  originalMachineValue: { valueEn: string | null; valueAr: string | null } | null;
  confirmedByName: string | null;
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
  // Unconfirmed mandatory fields are what block "Confirm and continue"; keep
  // them outlined in red (row + every input) so the remaining work is visible
  // at a glance instead of having to hunt down the disabled-button reason.
  const fieldClass = blocking
    ? "flex-1 border-state-bad ring-1 ring-state-bad/30 focus-visible:border-state-bad"
    : "flex-1";

  return (
    <div
      className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 ${
        blocking ? "border-l-2 border-l-state-bad bg-state-bad/[0.04]" : ""
      }`}
    >
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
        {originalMachineValue ? (
          <p className="mt-1 text-[11px] text-ink-500">
            {bilingual && (originalMachineValue.valueEn || originalMachineValue.valueAr)
              ? t("originalAiValueBoth", {
                  en: originalMachineValue.valueEn ?? "",
                  ar: originalMachineValue.valueAr ?? "",
                })
              : t("originalAiValueEn", { value: originalMachineValue.valueEn ?? "" })}
            {confirmedByName ? <> · {t("changedByField", { name: confirmedByName })}</> : null}
          </p>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row">
        <Field
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder={t("englishPlaceholder")}
          dir="ltr"
          className={fieldClass}
        />
        {bilingual ? (
          <Field
            value={ar}
            onChange={(e) => setAr(e.target.value)}
            placeholder={t("arabicPlaceholder")}
            dir="rtl"
            className={fieldClass}
          />
        ) : null}
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={(!dirty && !blocking) || saving}
        onClick={() => onSave(en, ar)}
        className="shrink-0"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : dirty ? t("save") : t("confirm")}
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

  // Claim items are judged against the whole extracted claim list, so their
  // "On the label" evidence shows every detected claim rather than only the
  // fragment the LLM proposal happened to quote.
  const detectedClaims = useMemo(() => {
    const f = detail.fields.find((x) => x.fieldKey === "claims_detected");
    return splitClaims(f?.valueEn ?? null, f?.valueAr ?? null);
  }, [detail.fields]);

  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [preview, setPreview] = useState<{ written: number; withheld: number; priorDataExists: boolean } | null>(null);

  function openPromoteDialog() {
    startPreviewTransition(async () => {
      const result = await previewPromotion(detail.id);
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "PROMOTE_FAILED"));
        return;
      }
      if (result.data.wouldDrop > 0) {
        toast.error(tErrors("CODE_MISMATCH"));
        return;
      }
      setPreview({ written: result.data.written, withheld: result.data.withheld, priorDataExists: result.data.priorDataExists });
    });
  }

  function promote() {
    startTransition(async () => {
      const result = await promoteToOfficialChecklist(detail.id);
      if (!result.ok) {
        toast.error(tErrors(result.error.split(":")[0] as "PROMOTE_FAILED"));
        return;
      }
      setPreview(null);
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
              missing: counts.MISSING ?? 0,
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
        <SectionCard
          key={section}
          section={section}
          verdicts={verdicts}
          isAr={isAr}
          assessmentId={detail.id}
          domain={domain}
          detectedClaims={detectedClaims}
          t={t}
          router={router}
        />
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
          {(detail.status === "ASSESSED" || detail.status === "BLOCKED_NO_CATEGORY_MATCH") && (
            <Button
              variant="outline"
              onClick={() => window.open(`/api/label-eval/${detail.id}/report?locale=${isAr ? "ar" : "en"}`, "_blank")}
            >
              {t("downloadReportButton")}
            </Button>
          )}
          {detail.promotedAt ? (
            <span className="text-xs text-ink-500">{t("alreadyPromoted")}</span>
          ) : (
            <Button disabled={previewPending} onClick={openPromoteDialog}>
              {previewPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("promoteButton")}
            </Button>
          )}
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("promoteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {preview ? t("promoteConfirmSummary", { written: preview.written, withheld: preview.withheld }) : null}
            </DialogDescription>
          </DialogHeader>
          {preview?.priorDataExists ? (
            <p className="rounded-lg border border-state-warn/30 bg-state-warn/10 p-3 text-sm text-state-warn">
              {t("promoteConfirmOverwriteWarning")}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={pending}>
              {t("promoteConfirmCancel")}
            </Button>
            <Button onClick={promote} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("promoteConfirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const detectedCategory = c?.overrideCategoryCode
    ? detail.availableCategories.find((cat) => cat.code === c.detectedCategoryCode)
    : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{t("classificationTitle")}</h2>
          <p className="mt-1 text-sm text-ink-700">
            {category ? (isAr ? category.nameAr : category.nameEn) : t("noCategoriesAvailable")}
            {c?.overrideCategoryCode ? <span className="ms-2 text-xs text-state-warn">{t("manuallyOverridden")}</span> : null}
          </p>
          {/*
            On a MANUAL run there is no AI-detected category to have overridden
            — setManualCategory writes overrideCategoryCode with
            detectedCategoryCode left null — so the "Reclassified by X, AI
            detected: —" line would describe a classification that never
            happened. Say who set it instead.
          */}
          {c?.overrideCategoryCode && c.overriddenByName ? (
            <p className="mt-1 text-[11px] text-ink-500">
              {detail.method === "MANUAL"
                ? t("classificationSetBy", { name: c.overriddenByName })
                : t("classificationOverriddenBy", {
                    name: c.overriddenByName,
                    detected: detectedCategory
                      ? isAr
                        ? detectedCategory.nameAr
                        : detectedCategory.nameEn
                      : (c.detectedCategoryCode ?? "—"),
                  })}
            </p>
          ) : null}
          {c?.rationale ? <p className="mt-1 text-xs text-ink-500">{c.rationale}</p> : null}
        </div>
      </div>
      {/*
        Re-classifying re-runs the whole cosmetics rule engine, which would
        overwrite every hand-typed verdict on a manual run. Manual assessments
        set their category through setManualCategory instead (and only while
        still in progress), so the picker is deliberately absent here.
      */}
      {detail.method === "AI" ? (
        <div className="mt-3">
          <ReclassifyPicker detail={detail} t={t} tErrors={tErrors} isAr={isAr} router={router} />
        </div>
      ) : null}
    </div>
  );
}

export function RequiredTestsTable({
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

/**
 * Exported for the manual workspace (manual-assessment-workspace.tsx), which
 * renders the identical rule checklist — same cards, same verdict picker,
 * same override action. Manual entry is not a second checklist UI; it is the
 * same one with nothing pre-filled.
 */
export function SectionCard({
  section,
  verdicts,
  isAr,
  assessmentId,
  domain,
  detectedClaims = [],
  t,
  router,
}: {
  section: string;
  verdicts: AssessmentDetailVerdict[];
  isAr: boolean;
  assessmentId: string;
  domain: LabelEvalDomain;
  /** Every claim extracted into the `claims_detected` field, for claim items. */
  detectedClaims?: string[];
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
            <VerdictCard
              key={v.kbRuleId}
              verdict={v}
              isAr={isAr}
              assessmentId={assessmentId}
              domain={domain}
              detectedClaims={detectedClaims}
              t={t}
              router={router}
            />
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
  domain,
  detectedClaims = [],
  t,
  router,
}: {
  verdict: AssessmentDetailVerdict;
  isAr: boolean;
  assessmentId: string;
  domain: LabelEvalDomain;
  detectedClaims?: string[];
  t: ReturnType<typeof useTranslations<"labelEval.workspace">>;
  router: ReturnType<typeof useRouter>;
}) {
  const meta = VERDICT_META[verdict.verdict] ?? VERDICT_META.NEEDS_REVIEW!;
  const Icon = meta.icon;
  const [overriding, setOverriding] = useState(false);
  const [rationale, setRationale] = useState("");
  const [pending, startTransition] = useTransition();
  const tErrors = useTranslations("labelEval.errors");

  // Workflow doc §12: cosmetics overrides must carry a reason. No equivalent
  // documented requirement for SFDA, so it stays optional there.
  const rationaleRequired = domain === "COSMETICS";

  const OPTIONS: string[] = ["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA", "MISSING"];

  function change(newVerdict: string) {
    if (rationaleRequired && !rationale.trim()) return;
    startTransition(async () => {
      const result = await overrideItemVerdict({
        assessmentId,
        kbRuleId: verdict.kbRuleId,
        expectedPreviousVerdict: verdict.verdict as never,
        newVerdict: newVerdict as never,
        rationale: rationale.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error as "OVERRIDE_FAILED"));
        return;
      }
      setOverriding(false);
      setRationale("");
      router.refresh();
    });
  }

  // Design doc §1 Principle 2: an LLM may propose a judgment verdict but
  // never silently decide it — this is the reviewer's explicit "I looked at
  // this AI proposal and agree" action, distinct from changing the value
  // (change() above). Until this (or a change) happens, the promotion gate
  // (isPromotableVerdict, promotion-eligibility.ts) refuses to write this
  // item to the official checklist no matter what it says.
  function confirmProposal() {
    startTransition(async () => {
      const result = await confirmProposedVerdict({ assessmentId, kbRuleId: verdict.kbRuleId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "CONFLICT"));
        return;
      }
      router.refresh();
    });
  }

  const isAiProposed = verdict.autoOrManual === "llm_proposed";
  // A claim item is judged against the whole extracted claim list, so show
  // every detected claim here instead of the single fragment an evaluator or
  // LLM proposal happened to quote.
  const showAllClaims = verdict.ruleType === "CLAIM_PHASE_ITEM" && detectedClaims.length > 0;

  return (
    <div className={cn("space-y-2 px-3 py-3", isAiProposed && "bg-state-info/5")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-ink-500">{verdict.code}{verdict.standard ? ` · ${verdict.standard}` : ""}</p>
          <p className="text-sm font-medium text-ink-900">
            {bilingualTitle(verdict.titleEn, verdict.titleAr, isAr, verdict.code)}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {isAiProposed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-state-info/40 bg-state-info/10 px-2 py-1 text-xs font-semibold text-state-info">
              <Sparkles className="size-3.5" />
              {t("aiProposedBadge")}
            </span>
          ) : null}
          <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold", meta.tone)}>
            <Icon className="size-3.5" />
            {t(meta.labelKey as "verdict.COMPLIANT")}
          </span>
        </div>
      </div>
      {verdict.rationale ? <p className="text-xs text-ink-600">{verdict.rationale}</p> : null}
      {showAllClaims ? (
        <div className="rounded border border-line bg-surface-alt/40 px-2 py-1.5 text-xs text-ink-700">
          <p className="font-medium">{t("evidenceLabel")}:</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-4">
            {detectedClaims.map((claim, i) => (
              <li key={`${i}-${claim}`}>{claim}</li>
            ))}
          </ul>
        </div>
      ) : verdict.evidenceText ? (
        <p className="rounded border border-line bg-surface-alt/40 px-2 py-1.5 text-xs text-ink-700">
          {t("evidenceLabel")}: {verdict.evidenceText}
        </p>
      ) : null}
      {isAiProposed ? <p className="text-[10px] text-state-info">{t("aiProposedNotice")}</p> : null}
      {verdict.autoOrManual === "llm_confirmed" ? (
        <p className="text-[10px] text-ink-500">{t("aiProposalConfirmed")}</p>
      ) : null}
      {verdict.autoOrManual === "manual_override" ? (
        <p className="text-[10px] text-ink-500">
          {verdict.overriddenByName && verdict.previousVerdict
            ? t("manuallyOverriddenByFrom", {
                name: verdict.overriddenByName,
                previous: t(`verdict.${verdict.previousVerdict}` as "verdict.COMPLIANT"),
              })
            : t("manuallyOverridden")}
        </p>
      ) : null}

      {overriding ? (
        <div className="space-y-2 pt-1">
          {rationaleRequired ? (
            <Textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder={t("overrideRationalePlaceholder")}
              className="min-h-16 text-xs"
            />
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                disabled={pending || (rationaleRequired && !rationale.trim())}
                onClick={() => change(opt)}
                className={cn(
                  "rounded-full border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  opt === verdict.verdict
                    ? VERDICT_META[opt]!.tone
                    : "border-line text-ink-600 hover:bg-surface-alt",
                )}
              >
                {t(VERDICT_META[opt]!.labelKey as "verdict.COMPLIANT")}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {isAiProposed ? (
            <Button size="sm" disabled={pending} onClick={confirmProposal}>
              {t("confirmAiProposal")}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => setOverriding(true)}>
            {t("changeAssessment")}
          </Button>
        </div>
      )}
    </div>
  );
}
