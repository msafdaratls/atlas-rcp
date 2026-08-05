"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  computeAssessment,
  type AssessmentDecision,
  type AssessmentState,
  type CheckItem,
  type CheckSet,
  type Verdict,
} from "@/lib/assessment";
import { saveAssessment } from "@/server/admin/actions";
import {
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Info,
  Loader2,
  Save,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  requestItemId: string;
  title?: string;
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

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function AssessmentPanel({
  requestItemId,
  title: panelTitle,
  checkSets,
  initial,
  editable,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.assessment");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();

  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(
    initial.verdicts ?? {},
  );
  const [notes, setNotes] = useState<Record<string, string>>(
    initial.notes ?? {},
  );
  const [dirty, setDirty] = useState(false);
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [openGuide, setOpenGuide] = useState<Record<string, boolean>>({});

  const summary = useMemo(
    () => computeAssessment(checkSets, { verdicts, notes }),
    [checkSets, verdicts, notes],
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

  function setNote(code: string, value: string) {
    setNotes((prev) => ({ ...prev, [code]: value }));
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      const cleanNotes: Record<string, string> = {};
      for (const [code, n] of Object.entries(notes)) {
        if (n.trim()) cleanNotes[code] = n.trim();
      }
      const result = await saveAssessment({
        requestItemId,
        verdicts,
        notes: cleanNotes,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setDirty(false);
      toast.success(t("saved"));
    });
  }

  const title = (en: string, ar: string) => (isAr ? ar : en);

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {panelTitle ? `${t("title")} — ${panelTitle}` : t("title")}
          </h2>
          <p className="text-xs text-ink-500">{t("subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            DECISION_TONE[summary.recommendation],
          )}
        >
          {t(`decision.${summary.recommendation}`)}
        </span>
      </div>

      {/* Score summary */}
      <div className="space-y-3 rounded-md border border-line bg-surface-alt/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-ink-600">
            {t("progress", { done: summary.assessed, total: summary.total })}
          </span>
          <span className="font-data text-ink-800">
            {t("overallRate")}: <strong>{pct(summary.overallRate)}</strong>
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-atlas-green transition-all"
            style={{
              width: `${summary.total ? (summary.assessed / summary.total) * 100 : 0}%`,
            }}
          />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {summary.sections.map((s) => (
            <div
              key={s.code}
              className="flex items-center justify-between gap-2 rounded border border-line bg-surface px-2 py-1 text-xs"
            >
              <span className="truncate text-ink-700" title={title(s.titleEn, s.titleAr)}>
                {title(s.titleEn, s.titleAr)}
              </span>
              <span className="shrink-0 font-data text-ink-500">
                {s.assessed}/{s.total} · {pct(s.rate)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Sections + items */}
      <div className="space-y-4">
        {checkSets.map((set) => {
          const score = summary.sections.find((x) => x.code === set.code);
          return (
            <div key={set.code} className="rounded-md border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-alt/50 px-3 py-2">
                <h3 className="text-sm font-semibold text-ink-900">
                  {title(set.titleEn, set.titleAr)}
                </h3>
                {score ? (
                  <span className="font-data text-xs text-ink-500">
                    {score.assessed}/{score.total} · {pct(score.rate)}
                  </span>
                ) : null}
              </div>
              <ul className="divide-y divide-line">
                {set.items.map((item, idx) => (
                  <AssessmentRow
                    key={item.code}
                    item={item}
                    index={idx + 1}
                    isAr={isAr}
                    verdict={verdicts[item.code]}
                    note={notes[item.code] ?? ""}
                    editable={editable}
                    noteOpen={!!openNotes[item.code]}
                    guideOpen={!!openGuide[item.code]}
                    onVerdict={(v) => setVerdict(item.code, v)}
                    onNote={(v) => setNote(item.code, v)}
                    onToggleNote={() =>
                      setOpenNotes((p) => ({ ...p, [item.code]: !p[item.code] }))
                    }
                    onToggleGuide={() =>
                      setOpenGuide((p) => ({ ...p, [item.code]: !p[item.code] }))
                    }
                    t={t}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

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

type RowProps = {
  item: CheckItem;
  index: number;
  isAr: boolean;
  verdict: Verdict | undefined;
  note: string;
  editable: boolean;
  noteOpen: boolean;
  guideOpen: boolean;
  onVerdict: (v: Verdict) => void;
  onNote: (v: string) => void;
  onToggleNote: () => void;
  onToggleGuide: () => void;
  t: ReturnType<typeof useTranslations>;
};

function AssessmentRow({
  item,
  index,
  isAr,
  verdict,
  note,
  editable,
  noteOpen,
  guideOpen,
  onVerdict,
  onNote,
  onToggleNote,
  onToggleGuide,
  t,
}: RowProps) {
  const verdictList: Verdict[] = ["COMPLIANT", "NON_COMPLIANT", "NA"];
  const guidance = [
    { label: t("guide.compliantWhen"), value: item.compliantWhen },
    { label: t("guide.evidenceRequired"), value: item.evidenceRequired },
    { label: t("guide.commonNonConformities"), value: item.commonNonConformities },
    { label: t("guide.decisionRule"), value: item.decisionRule },
    {
      label: t("guide.knowledgeBase"),
      value: isAr ? item.knowledgeBaseAr : item.knowledgeBaseEn,
    },
    { label: t("guide.referenceRange"), value: item.referenceRange },
  ].filter((g) => g.value);

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-900">
            <span className="font-data text-xs text-ink-400">{index}.</span>{" "}
            {isAr ? item.titleAr : item.titleEn}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {item.priority ? (
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  item.priority === "Critical"
                    ? "bg-state-bad/12 text-state-bad"
                    : item.priority === "High"
                      ? "bg-state-warn/12 text-state-warn"
                      : "bg-surface-alt text-ink-500",
                )}
              >
                {item.priority}
              </span>
            ) : null}
            {item.category ? (
              <span className="text-[10px] text-ink-400">{item.category}</span>
            ) : null}
            {guidance.length > 0 ? (
              <button
                type="button"
                onClick={onToggleGuide}
                className="inline-flex items-center gap-1 text-[11px] text-atlas-green hover:underline"
              >
                <Info className="size-3" />
                {t("guide.show")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleNote}
              className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:underline"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  noteOpen && "rotate-180",
                )}
              />
              {note ? t("note.edit") : t("note.add")}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {verdictList.map((v) => {
            const meta = VERDICT_META[v];
            const Icon = meta.icon;
            const active = verdict === v;
            return (
              <button
                key={v}
                type="button"
                disabled={!editable}
                onClick={() => onVerdict(v)}
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
      </div>

      {guideOpen && guidance.length > 0 ? (
        <dl className="mt-2 space-y-1 rounded-md border border-line bg-surface-alt/40 p-2 text-xs">
          {guidance.map((g) => (
            <div key={g.label} className="grid grid-cols-[auto_1fr] gap-2">
              <dt className="font-semibold text-ink-600">{g.label}:</dt>
              <dd className="whitespace-pre-line text-ink-700" dir="auto">
                {g.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {noteOpen ? (
        <Textarea
          value={note}
          onChange={(e) => onNote(e.target.value)}
          disabled={!editable}
          placeholder={t("note.placeholder")}
          rows={2}
          dir="auto"
          className="mt-2 text-sm"
        />
      ) : note ? (
        <p className="mt-2 rounded bg-surface-alt/60 px-2 py-1 text-xs text-ink-600" dir="auto">
          {note}
        </p>
      ) : null}
    </li>
  );
}
