/**
 * Service codes whose Evaluation step is the tariff-driven checklist flow
 * (technical regulation -> customs tariff item -> general/labeling/
 * specific-standard/documents checklists, see TariffEvaluationPanel) instead
 * of the plain "upload an Evaluation Report file" panel every other service
 * uses. Mirrors scoc-services.ts's pattern: a plain module (no "use server"/
 * "use client") shared verbatim between the client panel and the server
 * actions, so the two can never drift apart.
 */
import {
  combineAssessments,
  computeAssessment,
  type AssessmentSummary,
  type CheckSet,
  type Verdict,
} from "@/lib/assessment";

export const TARIFF_EVAL_SERVICE_CODES = ["SAB-001", "SFDA-COS-002"] as const;

export function isTariffEvalServiceCode(code: string): boolean {
  return (TARIFF_EVAL_SERVICE_CODES as readonly string[]).includes(code);
}

export type SnapshotStandard = {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
};

/**
 * One independently-scored block of the evaluation.
 *
 * `key` is also the key into `TariffEvaluation.sectionVerdicts`. Every
 * standard gets its own section — general standards included — because an item
 * code is only unique within its own standard. Sharing one verdict map across
 * standards lets a single answer satisfy a same-coded item in another block
 * and be counted twice, inflating both the total and the compliance rate.
 */
export type EvaluationSection = {
  key: string;
  titleEn: string;
  titleAr: string;
  checkSets: CheckSet[];
};

export const SECTION_GENERAL = "general";
export const SECTION_LABELING = "labeling";
export const SECTION_DOCUMENTS = "documents";
export const standardSectionKey = (standardId: string) => `std:${standardId}`;

/**
 * Everything an evaluation is judged against, pinned at the moment the tariff
 * item is selected. The panel and the scoring both read this and never the
 * live catalog, so a workbook import can never alter an evaluation that is
 * already under way or finished.
 */
export type TariffEvaluationSnapshot = {
  version: 1;
  regulation: { id: string; code: string; titleEn: string; titleAr: string };
  tariffItem: {
    id: string;
    hsCode: string;
    productTitleEn: string;
    productTitleAr: string;
    requiredCertificates: string[];
    conformityModule: string | null;
  };
  generalStandards: SnapshotStandard[];
  specificStandards: SnapshotStandard[];
  sections: EvaluationSection[];
  /** Identifies the template content; a mismatch means the panel is stale. */
  hash: string;
};

/** An evaluator-added checklist row that has no counterpart in the pinned template. */
export type ManualChecklistItem = {
  code: string;
  reference?: string;
  descriptionEn: string;
  descriptionAr: string;
};

export type SectionVerdicts = Record<
  string,
  {
    verdicts: Record<string, Verdict>;
    manualItems?: ManualChecklistItem[];
    notes?: Record<string, string>;
  }
>;

/** Folds manual items into a synthetic trailing check set, so scoring and progress treat them exactly like template items. */
export function withManualItems(checkSets: CheckSet[], manualItems: ManualChecklistItem[] = []): CheckSet[] {
  if (manualItems.length === 0) return checkSets;
  return [
    ...checkSets,
    {
      code: "manual",
      titleEn: "Manual items",
      titleAr: "بنود يدوية",
      items: manualItems.map((m) => ({
        code: m.code,
        titleEn: m.descriptionEn,
        titleAr: m.descriptionAr,
        applicability: m.reference,
      })),
    },
  ];
}

/** Deterministic across key insertion order, so an unchanged template hashes the same. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Hashes only what an evaluator actually answers — codes and titles, per
 * section. FNV-1a rather than a crypto digest so this module stays isomorphic:
 * the panel imports it, and `node:crypto` would break the client bundle. This
 * detects an accidentally stale panel, it is not a security boundary.
 */
export function hashSections(sections: EvaluationSection[]): string {
  const shape = sections.map((section) => ({
    key: section.key,
    items: section.checkSets.flatMap((set) =>
      set.items.map((item) => [item.code, item.titleEn, item.titleAr]),
    ),
  }));
  const input = stableStringify(shape);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}${input.length.toString(16)}`;
}

/**
 * Assemble the ordered sections for a regulation + tariff item. The order is
 * the order the panel renders and the evaluator works through: the
 * regulation's own general checklist, then each general standard, then
 * labeling, then each specific standard, then required documents.
 */
export function buildSections(input: {
  regulation: { generalChecklist: CheckSet[]; labelingChecklist: CheckSet[]; documentsChecklist: CheckSet[] };
  generalStandards: Array<SnapshotStandard & { checklist: CheckSet[] }>;
  specificStandards: Array<SnapshotStandard & { checklist: CheckSet[] }>;
}): EvaluationSection[] {
  const sections: EvaluationSection[] = [
    {
      key: SECTION_GENERAL,
      titleEn: "General Checklist",
      titleAr: "القائمة العامة",
      checkSets: input.regulation.generalChecklist,
    },
  ];

  for (const standard of input.generalStandards) {
    sections.push({
      key: standardSectionKey(standard.id),
      titleEn: standard.titleEn,
      titleAr: standard.titleAr,
      checkSets: standard.checklist,
    });
  }

  sections.push({
    key: SECTION_LABELING,
    titleEn: "Labeling Information",
    titleAr: "بيانات البطاقة الإيضاحية",
    checkSets: input.regulation.labelingChecklist,
  });

  for (const standard of input.specificStandards) {
    sections.push({
      key: standardSectionKey(standard.id),
      titleEn: standard.titleEn,
      titleAr: standard.titleAr,
      checkSets: standard.checklist,
    });
  }

  sections.push({
    key: SECTION_DOCUMENTS,
    titleEn: "Required Documents",
    titleAr: "المستندات المطلوبة",
    checkSets: input.regulation.documentsChecklist,
  });

  return sections;
}

/** Total answerable items across the snapshot — 0 means the catalog is unconfigured. */
export function snapshotItemCount(snapshot: TariffEvaluationSnapshot): number {
  return snapshot.sections.reduce(
    (total, section) => total + section.checkSets.reduce((n, set) => n + set.items.length, 0),
    0,
  );
}

/**
 * Score every section against its OWN verdict map, then combine.
 *
 * The source conformity tools fail an assessment outright on any non-compliant
 * item rather than averaging it into a rate, so a single NON_COMPLIANT
 * anywhere overrides the rate band and rejects. Shared by the server action
 * and the panel's live summary so both always agree.
 */
export function scoreSnapshot(
  snapshot: TariffEvaluationSnapshot,
  sectionVerdicts: SectionVerdicts,
): AssessmentSummary {
  const summary = combineAssessments(
    snapshot.sections.map((section) =>
      computeAssessment(withManualItems(section.checkSets, sectionVerdicts[section.key]?.manualItems), {
        verdicts: sectionVerdicts[section.key]?.verdicts ?? {},
      }),
    ),
  );
  if (summary.complete && summary.nonCompliant > 0) {
    return { ...summary, recommendation: "REJECTED" };
  }
  return summary;
}

/** Defensive parse of the stored snapshot JSON. */
export function parseSnapshot(raw: unknown): TariffEvaluationSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<TariffEvaluationSnapshot>;
  if (value.version !== 1 || !Array.isArray(value.sections) || !value.regulation || !value.tariffItem) {
    return null;
  }
  return value as TariffEvaluationSnapshot;
}

/** Defensive parse of the stored per-section verdict maps. */
export function parseSectionVerdicts(raw: unknown): SectionVerdicts {
  const out: SectionVerdicts = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { verdicts?: unknown; manualItems?: unknown; notes?: unknown };
    if (!entry.verdicts || typeof entry.verdicts !== "object") continue;
    const clean: Record<string, Verdict> = {};
    for (const [code, verdict] of Object.entries(entry.verdicts as Record<string, unknown>)) {
      if (verdict === "COMPLIANT" || verdict === "NON_COMPLIANT" || verdict === "NA") {
        clean[code] = verdict;
      }
    }
    const manualItems: ManualChecklistItem[] = Array.isArray(entry.manualItems)
      ? (entry.manualItems as unknown[])
          .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
          .filter((i) => typeof i.code === "string" && typeof i.descriptionEn === "string")
          .map((i) => ({
            code: i.code as string,
            reference: typeof i.reference === "string" ? i.reference : undefined,
            descriptionEn: i.descriptionEn as string,
            descriptionAr: typeof i.descriptionAr === "string" ? i.descriptionAr : (i.descriptionEn as string),
          }))
      : [];
    const notes: Record<string, string> = {};
    if (entry.notes && typeof entry.notes === "object") {
      for (const [code, note] of Object.entries(entry.notes as Record<string, unknown>)) {
        if (typeof note === "string" && note.trim()) notes[code] = note;
      }
    }
    out[key] = {
      verdicts: clean,
      ...(manualItems.length ? { manualItems } : {}),
      ...(Object.keys(notes).length ? { notes } : {}),
    };
  }
  return out;
}
