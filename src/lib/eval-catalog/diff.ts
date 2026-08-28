/**
 * What an upload would actually change, computed against the current catalog
 * so the operator approves a concrete change rather than a filename.
 *
 * Comparison is on normalised content, not raw JSON: jsonb key order and
 * absent-vs-empty optional fields must not show up as false "changed" rows.
 */
import type {
  ChecklistItemInput,
  RegulationPayload,
  StandardInput,
  TariffItemInput,
} from "@/lib/eval-catalog/parse";

export type EntityDiff = {
  added: string[];
  updated: string[];
  unchanged: number;
  /** Present in the catalog but absent from the sheet. Never deleted — reported so the operator knows the sheet is partial. */
  absentFromSheet: string[];
};

export type ChecklistDiff = {
  /** null when the sheet omitted this checklist entirely — it will be left untouched. */
  present: boolean;
  before: number;
  after: number;
  added: string[];
  removed: string[];
  retitled: string[];
};

export type RegulationDiff = {
  regulation: { isNew: boolean; changedFields: string[] };
  generalChecklist: ChecklistDiff;
  labelingChecklist: ChecklistDiff;
  documentsChecklist: ChecklistDiff;
  standards: EntityDiff & { checklists: Record<string, ChecklistDiff> };
  tariffItems: EntityDiff;
  /** In-flight evaluations are pinned to their own snapshot, so this is informational. */
  evaluationsReferencingRegulation: number;
};

export type ExistingRegulation = {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string;
  generalChecklist: ChecklistItemInput[];
  labelingChecklist: ChecklistItemInput[];
  documentsChecklist: ChecklistItemInput[];
  standards: StandardInput[];
  tariffItems: TariffItemInput[];
};

/**
 * Control characters, not punctuation: a delimiter that can appear inside a
 * title would let two different field splits produce the same key. Written as
 * escapes so this file stays text (a literal NUL makes git treat it as binary).
 */
const FIELD_SEP = "\u0000";
const ITEM_SEP = "\u0001";

function normaliseItem(item: ChecklistItemInput) {
  return [item.code, item.titleEn, item.titleAr, item.reference ?? "", item.conditional ? "1" : "0"].join(FIELD_SEP);
}

function diffChecklist(
  before: ChecklistItemInput[],
  after: ChecklistItemInput[] | null,
): ChecklistDiff {
  if (after === null) {
    return { present: false, before: before.length, after: before.length, added: [], removed: [], retitled: [] };
  }
  const beforeByCode = new Map(before.map((i) => [i.code, i]));
  const afterByCode = new Map(after.map((i) => [i.code, i]));

  const added = after.filter((i) => !beforeByCode.has(i.code)).map((i) => i.code);
  const removed = before.filter((i) => !afterByCode.has(i.code)).map((i) => i.code);
  const retitled = after
    .filter((i) => {
      const prev = beforeByCode.get(i.code);
      return prev && normaliseItem(prev) !== normaliseItem(i);
    })
    .map((i) => i.code);

  return { present: true, before: before.length, after: after.length, added, removed, retitled };
}

function normaliseStandard(standard: StandardInput) {
  return [
    standard.titleEn,
    standard.titleAr,
    standard.kind,
    standard.active ? "1" : "0",
    standard.items.map(normaliseItem).join(ITEM_SEP),
  ].join(FIELD_SEP);
}

function normaliseTariffItem(item: TariffItemInput) {
  return [
    item.productTitleEn,
    item.productTitleAr,
    [...item.specificStandardCodes].sort().join(","),
    [...item.requiredCertificates].sort().join(","),
    item.conformityModule ?? "",
    item.active ? "1" : "0",
  ].join(FIELD_SEP);
}

export function diffRegulation(
  payload: RegulationPayload,
  existing: ExistingRegulation | null,
  evaluationsReferencingRegulation: number,
): RegulationDiff {
  const changedFields: string[] = [];
  if (existing) {
    if (existing.titleEn !== payload.titleEn) changedFields.push("titleEn");
    if (existing.titleAr !== payload.titleAr) changedFields.push("titleAr");
  }

  const standardsBefore = new Map((existing?.standards ?? []).map((s) => [s.code, s]));
  const standardsAfter = payload.standards;
  const standardDiff: EntityDiff & { checklists: Record<string, ChecklistDiff> } = {
    added: [],
    updated: [],
    unchanged: 0,
    absentFromSheet: [],
    checklists: {},
  };

  if (standardsAfter) {
    for (const standard of standardsAfter) {
      const before = standardsBefore.get(standard.code);
      if (!before) {
        standardDiff.added.push(standard.code);
      } else if (normaliseStandard(before) !== normaliseStandard(standard)) {
        standardDiff.updated.push(standard.code);
      } else {
        standardDiff.unchanged += 1;
      }
      standardDiff.checklists[standard.code] = diffChecklist(before?.items ?? [], standard.items);
    }
    const afterCodes = new Set(standardsAfter.map((s) => s.code));
    standardDiff.absentFromSheet = [...standardsBefore.keys()].filter((code) => !afterCodes.has(code));
  } else {
    standardDiff.unchanged = standardsBefore.size;
  }

  const tariffBefore = new Map((existing?.tariffItems ?? []).map((i) => [i.hsCode, i]));
  const tariffAfter = payload.tariffItems;
  const tariffDiff: EntityDiff = { added: [], updated: [], unchanged: 0, absentFromSheet: [] };

  if (tariffAfter) {
    for (const item of tariffAfter) {
      const before = tariffBefore.get(item.hsCode);
      if (!before) tariffDiff.added.push(item.hsCode);
      else if (normaliseTariffItem(before) !== normaliseTariffItem(item)) tariffDiff.updated.push(item.hsCode);
      else tariffDiff.unchanged += 1;
    }
    const afterCodes = new Set(tariffAfter.map((i) => i.hsCode));
    tariffDiff.absentFromSheet = [...tariffBefore.keys()].filter((code) => !afterCodes.has(code));
  } else {
    tariffDiff.unchanged = tariffBefore.size;
  }

  return {
    regulation: { isNew: !existing, changedFields },
    generalChecklist: diffChecklist(existing?.generalChecklist ?? [], payload.generalChecklist),
    labelingChecklist: diffChecklist(existing?.labelingChecklist ?? [], payload.labelingChecklist),
    documentsChecklist: diffChecklist(existing?.documentsChecklist ?? [], payload.documentsChecklist),
    standards: standardDiff,
    tariffItems: tariffDiff,
    evaluationsReferencingRegulation,
  };
}

/** True when applying the import would change nothing. */
export function isEmptyDiff(diff: RegulationDiff): boolean {
  const checklistTouched = (c: ChecklistDiff) =>
    c.present && (c.added.length > 0 || c.removed.length > 0 || c.retitled.length > 0);
  return (
    !diff.regulation.isNew &&
    diff.regulation.changedFields.length === 0 &&
    !checklistTouched(diff.generalChecklist) &&
    !checklistTouched(diff.labelingChecklist) &&
    !checklistTouched(diff.documentsChecklist) &&
    diff.standards.added.length === 0 &&
    diff.standards.updated.length === 0 &&
    diff.tariffItems.added.length === 0 &&
    diff.tariffItems.updated.length === 0
  );
}
