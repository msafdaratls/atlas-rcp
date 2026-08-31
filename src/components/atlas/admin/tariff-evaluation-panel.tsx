"use client";

import { EvaluationReportPanel } from "@/components/atlas/admin/evaluation-report-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { computeAssessment, type AssessmentDecision, type Verdict } from "@/lib/assessment";
import {
  scoreSnapshot,
  snapshotItemCount,
  withManualItems,
  type EvaluationSection,
  type ManualChecklistItem,
  type SectionVerdicts,
} from "@/lib/tariff-evaluation-services";
import { cn } from "@/lib/utils";
import type { AdminRequestDetailItem } from "@/server/admin/queries";
import {
  completeTariffEvaluation,
  listTariffItemsForRegulation,
  refreshTariffEvaluationTemplate,
  saveTariffEvaluationVerdicts,
  selectTariffEvaluation,
  type TariffEvaluationBundle,
} from "@/server/admin/tariff-evaluation-actions";
import {
  CheckCircle2,
  CircleSlash,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Regulation = AdminRequestDetailItem["tariffRegulations"][number];
type Document = AdminRequestDetailItem["documents"][number];

type Props = {
  requestItemId: string;
  serviceCode: string;
  title?: string;
  regulations: Regulation[];
  tariffEvaluation: AdminRequestDetailItem["tariffEvaluation"];
  documents: Document[];
  editable: boolean;
};

const VERDICT_META: Record<Verdict, { icon: typeof CheckCircle2; on: string; off: string }> = {
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

type ManualDraft = { code: string; reference: string; descriptionEn: string; descriptionAr: string };

const EMPTY_DRAFT: ManualDraft = { code: "", reference: "", descriptionEn: "", descriptionAr: "" };

/** One snapshot section: toggle-verdict rows (template + evaluator-added manual rows) plus its own progress readout. */
function ChecklistSection({
  section,
  verdicts,
  manualItems,
  notes,
  onToggle,
  onNoteChange,
  onAddManualItem,
  onRemoveManualItem,
  editable,
  isAr,
  t,
}: {
  section: EvaluationSection;
  verdicts: Record<string, Verdict>;
  manualItems: ManualChecklistItem[];
  notes: Record<string, string>;
  onToggle: (code: string, v: Verdict) => void;
  onNoteChange: (code: string, note: string) => void;
  onAddManualItem: (item: ManualChecklistItem) => boolean;
  onRemoveManualItem: (code: string) => void;
  editable: boolean;
  isAr: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_DRAFT);

  const checkSetsWithManual = useMemo(
    () => withManualItems(section.checkSets, manualItems),
    [section.checkSets, manualItems],
  );
  const items = section.checkSets.flatMap((s) => s.items);
  const summary = useMemo(
    () => computeAssessment(checkSetsWithManual, { verdicts }),
    [checkSetsWithManual, verdicts],
  );
  const title = isAr ? section.titleAr : section.titleEn;

  function submitDraft() {
    const code = draft.code.trim();
    const descriptionEn = draft.descriptionEn.trim();
    if (!code || !descriptionEn) return;
    const added = onAddManualItem({
      code,
      reference: draft.reference.trim() || undefined,
      descriptionEn,
      descriptionAr: draft.descriptionAr.trim() || descriptionEn,
    });
    if (!added) {
      toast.error(t("manualItemDuplicateCode"));
      return;
    }
    setDraft(EMPTY_DRAFT);
    setAdding(false);
  }

  if (items.length === 0 && manualItems.length === 0 && !editable) {
    return (
      <div className="rounded-lg border border-dashed border-line-strong bg-surface-alt/40 p-3 text-xs text-ink-500">
        {title} — {t("emptyTemplate")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-ink-800">{title}</h4>
        <span className="text-xs text-ink-500">
          {t("progress", { done: summary.assessed, total: summary.total })}
        </span>
      </div>
      {items.length === 0 && manualItems.length === 0 ? (
        <p className="text-xs text-ink-500">{t("emptyTemplate")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {items.map((item, idx) => (
            <li key={item.code} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5">
              <p className="min-w-0 flex-1 text-sm text-ink-900">
                <span className="font-data text-xs text-ink-400">{idx + 1}.</span>{" "}
                {isAr ? item.titleAr : item.titleEn}
                {item.applicability ? (
                  <span className="block text-xs text-ink-500">{item.applicability}</span>
                ) : null}
              </p>
              <VerdictButtons value={verdicts[item.code]} onChange={(v) => onToggle(item.code, v)} editable={editable} t={t} />
            </li>
          ))}
          {manualItems.map((item) => (
            <li key={item.code} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 bg-surface-alt/30">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm text-ink-900">
                  <span className="me-1.5 inline-flex items-center rounded-full border border-line-strong px-1.5 py-0.5 font-data text-[10px] text-ink-500">
                    {item.code}
                  </span>
                  <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 me-1.5">
                    {t("manual")}
                  </span>
                  {isAr ? item.descriptionAr : item.descriptionEn}
                  {item.reference ? <span className="block text-xs text-ink-500">{item.reference}</span> : null}
                </p>
                <Textarea
                  value={notes[item.code] ?? ""}
                  onChange={(e) => onNoteChange(item.code, e.target.value)}
                  placeholder={t("notesPlaceholder")}
                  disabled={!editable}
                  rows={1}
                  className="min-h-8 text-xs"
                />
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <VerdictButtons value={verdicts[item.code]} onChange={(v) => onToggle(item.code, v)} editable={editable} t={t} />
                {editable ? (
                  <button
                    type="button"
                    title={t("removeManualItem")}
                    onClick={() => onRemoveManualItem(item.code)}
                    className="inline-flex items-center rounded-md border border-line px-2 py-1 text-state-bad hover:bg-state-bad/10"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editable ? (
        adding ? (
          <div className="space-y-2 rounded-md border border-dashed border-line-strong p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                placeholder={t("manualItemCode")}
                className="font-data"
              />
              <Input
                value={draft.reference}
                onChange={(e) => setDraft((d) => ({ ...d, reference: e.target.value }))}
                placeholder={t("manualItemReference")}
              />
            </div>
            <Textarea
              value={isAr ? draft.descriptionAr : draft.descriptionEn}
              onChange={(e) =>
                setDraft((d) =>
                  isAr ? { ...d, descriptionAr: e.target.value } : { ...d, descriptionEn: e.target.value },
                )
              }
              placeholder={t("manualItemDescriptionPlaceholder")}
              rows={2}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => { setAdding(false); setDraft(EMPTY_DRAFT); }}>
                {t("cancel")}
              </Button>
              <Button type="button" size="sm" onClick={submitDraft}>
                {t("addItem")}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t("addManualItem")}
          </Button>
        )
      ) : null}
    </div>
  );
}

function VerdictButtons({
  value,
  onChange,
  editable,
  t,
}: {
  value: Verdict | undefined;
  onChange: (v: Verdict) => void;
  editable: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {(["COMPLIANT", "NON_COMPLIANT", "NA"] as Verdict[]).map((v) => {
        const meta = VERDICT_META[v];
        const Icon = meta.icon;
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            disabled={!editable}
            onClick={() => onChange(v)}
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
  );
}

/**
 * PCOC/SCOC tariff-driven evaluation (SAB-001/SFDA-COS-002 only): technical
 * regulation → customs tariff item → resolved standards/certificates/module →
 * one checklist section per general standard, labeling, each specific
 * standard, and required documents → merged decision.
 *
 * Everything rendered after selection comes from the evaluation's pinned
 * `snapshot`, never the live catalog, so a regulation workbook import can
 * never change what an in-flight or finished evaluation is judged against.
 */
export function TariffEvaluationPanel({
  requestItemId,
  serviceCode,
  title: panelTitle,
  regulations,
  tariffEvaluation,
  documents,
  editable,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.tariffEvaluation");
  const tErrors = useTranslations("adminOps.requestDetail.tariffEvaluation.errors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();
  const [savePending, startSaveTransition] = useTransition();

  const [bundle, setBundle] = useState<TariffEvaluationBundle | null>(tariffEvaluation);
  const [regulationId, setRegulationId] = useState(tariffEvaluation?.technicalRegulationId ?? "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; hsCode: string; productTitleEn: string; productTitleAr: string }>
  >([]);
  const [verdicts, setVerdicts] = useState<SectionVerdicts>(tariffEvaluation?.sectionVerdicts ?? {});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const snapshot = bundle?.snapshot ?? null;
  const anyDirty = Object.values(dirty).some(Boolean);

  function adopt(next: TariffEvaluationBundle) {
    setBundle(next);
    setVerdicts(next.sectionVerdicts);
    setDirty({});
  }

  function search(q: string, regId: string) {
    setQuery(q);
    if (!regId) return;
    startTransition(async () => {
      const result = await listTariffItemsForRegulation({
        technicalRegulationId: regId,
        query: q || undefined,
      });
      if (result.ok) setResults(result.data);
    });
  }

  function onRegulationChange(regId: string) {
    setRegulationId(regId);
    setResults([]);
    setQuery("");
    search("", regId);
  }

  function pickTariffItem(tariffItemId: string) {
    startTransition(async () => {
      const result = await selectTariffEvaluation({
        requestItemId,
        technicalRegulationId: regulationId,
        tariffItemId,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      adopt(result.data);
      setResults([]);
      toast.success(t("selected"));
    });
  }

  function toggle(sectionKey: string) {
    return (code: string, v: Verdict) => {
      if (!editable) return;
      setVerdicts((prev) => {
        const current = { ...(prev[sectionKey]?.verdicts ?? {}) };
        if (current[code] === v) delete current[code];
        else current[code] = v;
        return { ...prev, [sectionKey]: { ...prev[sectionKey], verdicts: current } };
      });
      setDirty((prev) => ({ ...prev, [sectionKey]: true }));
    };
  }

  function changeNote(sectionKey: string) {
    return (code: string, note: string) => {
      if (!editable) return;
      setVerdicts((prev) => {
        const notes = { ...(prev[sectionKey]?.notes ?? {}) };
        if (note.trim()) notes[code] = note;
        else delete notes[code];
        return { ...prev, [sectionKey]: { ...prev[sectionKey], verdicts: prev[sectionKey]?.verdicts ?? {}, notes } };
      });
      setDirty((prev) => ({ ...prev, [sectionKey]: true }));
    };
  }

  function addManualItem(sectionKey: string) {
    return (item: ManualChecklistItem): boolean => {
      let added = true;
      setVerdicts((prev) => {
        const existing = prev[sectionKey]?.manualItems ?? [];
        if (existing.some((m) => m.code === item.code)) {
          added = false;
          return prev;
        }
        return {
          ...prev,
          [sectionKey]: {
            ...prev[sectionKey],
            verdicts: prev[sectionKey]?.verdicts ?? {},
            manualItems: [...existing, item],
          },
        };
      });
      if (added) setDirty((prev) => ({ ...prev, [sectionKey]: true }));
      return added;
    };
  }

  function removeManualItem(sectionKey: string) {
    return (code: string) => {
      if (!editable) return;
      setVerdicts((prev) => {
        const manualItems = (prev[sectionKey]?.manualItems ?? []).filter((m) => m.code !== code);
        const verdictsMap = { ...(prev[sectionKey]?.verdicts ?? {}) };
        delete verdictsMap[code];
        const notes = { ...(prev[sectionKey]?.notes ?? {}) };
        delete notes[code];
        return { ...prev, [sectionKey]: { verdicts: verdictsMap, manualItems, notes } };
      });
      setDirty((prev) => ({ ...prev, [sectionKey]: true }));
    };
  }

  function saveSection(sectionKey: string) {
    if (!snapshot) return;
    startSaveTransition(async () => {
      const result = await saveTariffEvaluationVerdicts({
        requestItemId,
        sectionKey,
        templateHash: snapshot.hash,
        verdicts: verdicts[sectionKey]?.verdicts ?? {},
        manualItems: verdicts[sectionKey]?.manualItems ?? [],
        notes: verdicts[sectionKey]?.notes ?? {},
      });
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      setDirty((prev) => ({ ...prev, [sectionKey]: false }));
      setBundle((prev) => (prev ? { ...prev, finalDecision: null, completedAt: null } : prev));
      toast.success(t("saved"));
    });
  }

  function refreshTemplate() {
    startSaveTransition(async () => {
      const result = await refreshTariffEvaluationTemplate({ requestItemId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      adopt(result.data.bundle);
      toast.success(
        result.data.droppedAnswers > 0
          ? t("refreshedWithDropped", { count: result.data.droppedAnswers })
          : t("refreshed"),
      );
    });
  }

  function complete() {
    startSaveTransition(async () => {
      const result = await completeTariffEvaluation({ requestItemId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      setBundle((prev) =>
        prev
          ? { ...prev, finalDecision: result.data.recommendation, completedAt: new Date().toISOString() }
          : prev,
      );
      toast.success(t("completed"));
    });
  }

  const summary = useMemo(
    () => (snapshot ? scoreSnapshot(snapshot, verdicts) : null),
    [snapshot, verdicts],
  );
  const hasItems = snapshot ? snapshotItemCount(snapshot) > 0 : false;

  const resolvedInfo: Array<{ label: string; node: React.ReactNode }> = snapshot
    ? [
        {
          label: t("hsCode"),
          node: <span className="font-data text-ink-900">{snapshot.tariffItem.hsCode}</span>,
        },
        {
          label: t("product"),
          node: (
            <span className="text-ink-900">
              {isAr ? snapshot.tariffItem.productTitleAr : snapshot.tariffItem.productTitleEn}
            </span>
          ),
        },
        {
          label: t("generalStandard"),
          node: <StandardList standards={snapshot.generalStandards} isAr={isAr} emptyLabel={t("none")} />,
        },
        {
          label: t("specificStandard"),
          node: <StandardList standards={snapshot.specificStandards} isAr={isAr} emptyLabel={t("none")} />,
        },
        {
          label: t("requiredCertificates"),
          node:
            snapshot.tariffItem.requiredCertificates.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {snapshot.tariffItem.requiredCertificates.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-ink-700"
                  >
                    {c}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-ink-900">{t("none")}</span>
            ),
        },
        {
          label: t("conformityModule"),
          node: <span className="text-ink-900">{snapshot.tariffItem.conformityModule ?? t("none")}</span>,
        },
      ]
    : [];

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">
            {t("title")}
            {panelTitle ? <span className="text-ink-500"> · {panelTitle}</span> : null}
          </h3>
          <p className="text-xs text-ink-500">{t("subtitle")}</p>
        </div>
        {bundle?.finalDecision ? (
          <span
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              DECISION_TONE[bundle.finalDecision as AssessmentDecision],
            )}
          >
            {t(`status.${bundle.finalDecision}` as "status.ACCEPTED")}
          </span>
        ) : null}
      </div>

      {/* Step 1: technical regulation */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-ink-600">{t("regulation")}</label>
        <Select value={regulationId} onValueChange={onRegulationChange} disabled={!editable}>
          <SelectTrigger>
            <SelectValue placeholder={t("regulationPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {regulations.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {isAr ? r.titleAr : r.titleEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {regulations.length === 0 ? <p className="text-xs text-ink-500">{t("noRegulations")}</p> : null}
      </div>

      {/* Step 2: customs tariff item */}
      {regulationId && editable ? (
        <div className="space-y-1">
          <label className="text-xs font-medium text-ink-600">{t("tariffItem")}</label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-ink-400 ltr:left-2.5 rtl:right-2.5" />
            <Input
              value={query}
              onChange={(e) => search(e.target.value, regulationId)}
              placeholder={t("tariffItemPlaceholder")}
              className="ltr:pl-8 rtl:pr-8"
              dir="ltr"
            />
          </div>
          {pending ? <Loader2 className="size-4 animate-spin text-ink-400" /> : null}
          {results.length > 0 ? (
            <ul className="max-h-64 overflow-y-auto rounded-md border border-line">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => pickTariffItem(r.id)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-line px-3 py-2 text-start text-sm last:border-b-0 hover:bg-surface-alt"
                  >
                    <span className="font-data text-xs text-ink-400">{r.hsCode}</span>
                    <span className="text-ink-900">{isAr ? r.productTitleAr : r.productTitleEn}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Step 3: what the tariff item resolves to */}
      {snapshot ? (
        <div className="grid gap-3 rounded-lg border border-line bg-surface-alt/40 p-3 text-sm sm:grid-cols-2">
          {resolvedInfo.map((entry) => (
            <div key={entry.label}>
              <span className="block text-xs font-medium text-ink-500">{entry.label}</span>
              {entry.node}
            </div>
          ))}
        </div>
      ) : null}

      {/* The Evaluation Report upload is NOT required alongside a technical-
          regulation assessment — the assessment is the evidence. It only
          appears in the fallback the server gate uses (see
          hasEvaluationReportForAllItems): no regulation/tariff item selected
          yet, or a pinned template with nothing to answer. */}
      {!hasItems ? (
        <EvaluationReportPanel
          requestItemId={requestItemId}
          serviceCode={serviceCode}
          documents={documents}
          editable={editable}
        />
      ) : null}

      {/* Steps 4-7: one section per checklist */}
      {snapshot ? (
        <div className="space-y-4">
          {snapshot.sections.map((section) => (
            <div key={section.key} className="space-y-2">
              <ChecklistSection
                section={section}
                verdicts={verdicts[section.key]?.verdicts ?? {}}
                manualItems={verdicts[section.key]?.manualItems ?? []}
                notes={verdicts[section.key]?.notes ?? {}}
                onToggle={toggle(section.key)}
                onNoteChange={changeNote(section.key)}
                onAddManualItem={addManualItem(section.key)}
                onRemoveManualItem={removeManualItem(section.key)}
                editable={editable}
                isAr={isAr}
                t={t}
              />
              {editable && dirty[section.key] ? (
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-state-warn">{t("unsaved")}</span>
                  <Button type="button" size="sm" disabled={savePending} onClick={() => saveSection(section.key)}>
                    {savePending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    {t("save")}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          {summary ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-alt/40 p-3">
              <p className="text-xs text-ink-600">
                {hasItems
                  ? t("progress", { done: summary.assessed, total: summary.total })
                  : t("errors.NO_CHECKLIST_ITEMS")}
              </p>
              {editable ? (
                <div className="flex items-center gap-2">
                  {/* Refresh re-reads verdicts from the server, so unsaved
                      toggles would be discarded without warning — same guard
                      Complete uses. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={savePending || anyDirty}
                    onClick={refreshTemplate}
                  >
                    <RefreshCw className="size-4" />
                    {t("refresh")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={savePending || anyDirty || !summary.complete || !hasItems}
                    onClick={complete}
                  >
                    {savePending ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
                    {t("complete")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StandardList({
  standards,
  isAr,
  emptyLabel,
}: {
  standards: Array<{ id: string; code: string; titleEn: string; titleAr: string }>;
  isAr: boolean;
  emptyLabel: string;
}) {
  if (standards.length === 0) return <span className="text-ink-900">{emptyLabel}</span>;
  return (
    <ul className="text-ink-900">
      {standards.map((s) => (
        <li key={s.id}>
          <span className="font-data text-xs text-ink-500">{s.code}</span> {isAr ? s.titleAr : s.titleEn}
        </li>
      ))}
    </ul>
  );
}

