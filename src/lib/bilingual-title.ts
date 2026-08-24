/**
 * Bilingual title fallback for KB-sourced rule and checklist text.
 *
 * KB content originates in supplier workbooks, and some rows carry a literal
 * "0" in a title column where the translation is simply absent rather than a
 * blank cell. Confirmed in the live GSO 2528 claims sheet: every
 * General-category claim from CLAIM-GEN-3-2 onward has "0" in its
 * "Claim (English)" column while the Arabic column holds the real question
 * (see the note in prisma/seed.ts above the GSO_2528 check set — the "0" is
 * carried through deliberately rather than invented over).
 *
 * "0" is a truthy, non-empty string, so it slips past every ordinary
 * `en || ar` / `en ?? ar` fallback and renders as a bare digit where a
 * compliance question should be — asking a reviewer to judge an item whose
 * text they cannot read in either language. Treating such placeholders as
 * absent restores the fallback each call site already intended. Nothing is
 * invented: an item with no usable English falls back to the Arabic the
 * source actually provides, so the translation gap stays visible.
 */

/**
 * Values that occupy a title column without carrying a title. Kept
 * deliberately narrow — only tokens observed in real imported KB data. A
 * genuine title is never a bare digit, so this cannot mask real content.
 */
const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set(["0", "-", "—", "n/a", "N/A", "null"]);

/** True when the value is a string carrying actual human-readable text. */
export function isMeaningfulTitle(value: string | null | undefined): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !PLACEHOLDER_TITLES.has(trimmed) && !PLACEHOLDER_TITLES.has(trimmed.toLowerCase());
}

/**
 * Picks the title for the reader's locale, falling back to the other language
 * when the preferred one is missing or a placeholder, and finally to
 * `fallback` (pass the rule code so a row is never rendered blank).
 */
export function bilingualTitle(
  titleEn: string | null | undefined,
  titleAr: string | null | undefined,
  isAr: boolean,
  fallback = "",
): string {
  const preferred = isAr ? titleAr : titleEn;
  const secondary = isAr ? titleEn : titleAr;
  if (isMeaningfulTitle(preferred)) return preferred.trim();
  if (isMeaningfulTitle(secondary)) return secondary.trim();
  return fallback;
}

/**
 * Normalises a title read out of a workbook cell for storage: a placeholder
 * becomes `null` so downstream consumers that never render through
 * `bilingualTitle` — the LLM judgment prompt and the assistant's KB search —
 * see an honestly-absent value instead of a digit they would treat as text.
 */
export function normaliseTitle(value: string | null | undefined): string | null {
  return isMeaningfulTitle(value) ? value.trim() : null;
}
