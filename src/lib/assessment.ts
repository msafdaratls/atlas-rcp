/**
 * Technical-review assessment scoring.
 *
 * Mirrors the SFDA "Food Supplement Label Assessment" workbook: a reviewer
 * marks every verification item Compliant / Non-Compliant / N/A. The
 * compliance rate per section is `compliant / (compliant + nonCompliant)`
 * — N/A items are excluded. The final recommendation gate is:
 *   • 100%           → Accepted
 *   • ≥ 80% (< 100%) → Accepted with remarks
 *   • < 80%          → Rejected
 * A recommendation is only firm once every item has a verdict.
 */

export type Verdict = "COMPLIANT" | "NON_COMPLIANT" | "NA";

export const VERDICTS: Verdict[] = ["COMPLIANT", "NON_COMPLIANT", "NA"];

export type CheckItem = {
  code: string;
  titleEn: string;
  titleAr: string;
  priority?: string;
  category?: string;
  knowledgeBaseEn?: string;
  knowledgeBaseAr?: string;
  evidenceRequired?: string;
  compliantWhen?: string;
  commonNonConformities?: string;
  referenceRange?: string;
  applicability?: string;
  decisionRule?: string;
};

export type CheckSet = {
  code: string;
  titleEn: string;
  titleAr: string;
  standard?: string;
  itemCount?: number;
  items: CheckItem[];
};

/** Persisted on `Request.assessment` as JSON. */
export type AssessmentState = {
  verdicts: Record<string, Verdict>;
  notes?: Record<string, string>;
  updatedAt?: string;
  updatedByUserId?: string;
};

export type AssessmentDecision =
  | "ACCEPTED"
  | "ACCEPTED_WITH_REMARKS"
  | "REJECTED"
  | "INCOMPLETE";

export type SectionScore = {
  code: string;
  titleEn: string;
  titleAr: string;
  standard?: string;
  total: number;
  compliant: number;
  nonCompliant: number;
  na: number;
  /** Items with any verdict (compliant + nonCompliant + na). */
  assessed: number;
  /** Items still awaiting a verdict. */
  pending: number;
  /** compliant / (compliant + nonCompliant); null when denominator is 0. */
  rate: number | null;
};

export type AssessmentSummary = {
  sections: SectionScore[];
  total: number;
  compliant: number;
  nonCompliant: number;
  na: number;
  assessed: number;
  pending: number;
  /** True once every item across every section has a verdict. */
  complete: boolean;
  /** Overall compliant / (compliant + nonCompliant); null when denominator is 0. */
  overallRate: number | null;
  recommendation: AssessmentDecision;
};

/** Compliant-with-remarks threshold (inclusive lower bound). */
export const REMARKS_THRESHOLD = 0.8;

function isVerdict(value: unknown): value is Verdict {
  return value === "COMPLIANT" || value === "NON_COMPLIANT" || value === "NA";
}

/** Coerce arbitrary JSON (Prisma) into a well-formed AssessmentState. */
export function parseAssessment(raw: unknown): AssessmentState {
  const state: AssessmentState = { verdicts: {}, notes: {} };
  if (!raw || typeof raw !== "object") return state;
  const obj = raw as Record<string, unknown>;
  if (obj.verdicts && typeof obj.verdicts === "object") {
    for (const [code, v] of Object.entries(obj.verdicts as Record<string, unknown>)) {
      if (isVerdict(v)) state.verdicts[code] = v;
    }
  }
  if (obj.notes && typeof obj.notes === "object") {
    for (const [code, n] of Object.entries(obj.notes as Record<string, unknown>)) {
      if (typeof n === "string" && n.trim()) state.notes![code] = n;
    }
  }
  if (typeof obj.updatedAt === "string") state.updatedAt = obj.updatedAt;
  if (typeof obj.updatedByUserId === "string")
    state.updatedByUserId = obj.updatedByUserId;
  return state;
}

function rateOf(compliant: number, nonCompliant: number): number | null {
  const denom = compliant + nonCompliant;
  return denom === 0 ? null : compliant / denom;
}

/**
 * Decision gate. `rate` is null when nothing is Compliant/Non-Compliant
 * (e.g. every item N/A) — treated as passing since nothing failed.
 */
export function recommendDecision(
  rate: number | null,
  complete: boolean,
): AssessmentDecision {
  if (!complete) return "INCOMPLETE";
  if (rate === null || rate >= 1) return "ACCEPTED";
  if (rate >= REMARKS_THRESHOLD) return "ACCEPTED_WITH_REMARKS";
  return "REJECTED";
}

/** Score a set of verdicts against the service's check sets. */
export function computeAssessment(
  checkSets: CheckSet[],
  state: AssessmentState,
): AssessmentSummary {
  const verdicts = state.verdicts ?? {};
  const sections: SectionScore[] = [];

  let total = 0;
  let compliant = 0;
  let nonCompliant = 0;
  let na = 0;

  for (const set of checkSets) {
    let sTotal = 0;
    let sCompliant = 0;
    let sNon = 0;
    let sNa = 0;
    for (const item of set.items ?? []) {
      sTotal += 1;
      const v = verdicts[item.code];
      if (v === "COMPLIANT") sCompliant += 1;
      else if (v === "NON_COMPLIANT") sNon += 1;
      else if (v === "NA") sNa += 1;
    }
    const assessed = sCompliant + sNon + sNa;
    sections.push({
      code: set.code,
      titleEn: set.titleEn,
      titleAr: set.titleAr,
      standard: set.standard,
      total: sTotal,
      compliant: sCompliant,
      nonCompliant: sNon,
      na: sNa,
      assessed,
      pending: sTotal - assessed,
      rate: rateOf(sCompliant, sNon),
    });
    total += sTotal;
    compliant += sCompliant;
    nonCompliant += sNon;
    na += sNa;
  }

  const assessed = compliant + nonCompliant + na;
  const complete = total > 0 && assessed === total;
  const overallRate = rateOf(compliant, nonCompliant);

  return {
    sections,
    total,
    compliant,
    nonCompliant,
    na,
    assessed,
    pending: total - assessed,
    complete,
    overallRate,
    recommendation: recommendDecision(overallRate, complete),
  };
}

/** Normalise unknown JSON into a typed CheckSet[] (defensive against bad data). */
export function parseCheckSets(raw: unknown): CheckSet[] {
  if (!Array.isArray(raw)) return [];
  const out: CheckSet[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const set = s as Record<string, unknown>;
    if (typeof set.code !== "string") continue;
    const items: CheckItem[] = Array.isArray(set.items)
      ? (set.items as unknown[])
          .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
          .filter((i) => typeof i.code === "string")
          .map((i) => i as unknown as CheckItem)
      : [];
    out.push({
      code: set.code,
      titleEn: typeof set.titleEn === "string" ? set.titleEn : set.code,
      titleAr: typeof set.titleAr === "string" ? set.titleAr : set.code,
      standard: typeof set.standard === "string" ? set.standard : undefined,
      itemCount: typeof set.itemCount === "number" ? set.itemCount : items.length,
      items,
    });
  }
  return out;
}

/** True when this service has an item-level checklist worth reviewing. */
export function hasCheckItems(checkSets: CheckSet[]): boolean {
  return checkSets.some((s) => (s.items?.length ?? 0) > 0);
}
