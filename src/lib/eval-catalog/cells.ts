/**
 * Reading a spreadsheet cell is hostile-input handling, not a formality.
 *
 * exceljs hands back a different shape depending on how the author produced
 * the cell — a plain string, a number, a formula result, rich text (what you
 * get when part of a cell is bold), or a hyperlink object. On top of that,
 * Arabic-authored sheets routinely carry RTL control marks, non-breaking and
 * zero-width spaces, Arabic-Indic digits, and unnormalised Arabic. Every one
 * of those silently corrupts a code comparison if passed straight through.
 */

/** exceljs CellValue is loosely typed; narrow it here rather than at each call site. */
type RichTextRun = { text?: unknown };
type CellLike =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | { richText?: RichTextRun[] }
  | { text?: unknown; hyperlink?: unknown }
  | { result?: unknown; formula?: unknown }
  | { error?: unknown };

const ARABIC_INDIC_START = 0x0660; // ٠-٩
const EXTENDED_ARABIC_INDIC_START = 0x06f0; // ۰-۹

/** ٠١٢… and ۰۱۲… → 0123…, so a code typed on an Arabic keyboard still matches. */
export function normaliseDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= ARABIC_INDIC_START && cp <= ARABIC_INDIC_START + 9) {
      out += String(cp - ARABIC_INDIC_START);
    } else if (cp >= EXTENDED_ARABIC_INDIC_START && cp <= EXTENDED_ARABIC_INDIC_START + 9) {
      out += String(cp - EXTENDED_ARABIC_INDIC_START);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Strip the invisible characters that make two visually identical strings
 * compare unequal: RTL/LTR marks, the Arabic letter mark, BOM/zero-width
 * joiners, and non-breaking spaces. Then NFC-normalise so decomposed Arabic
 * matches its composed form.
 */
export function normaliseText(input: string): string {
  return input
    .replace(/[‎‏؜​‌‍﻿]/g, "")
    .replace(/ /g, " ")
    .normalize("NFC")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export type CellRead =
  | { kind: "text"; value: string }
  | { kind: "number"; value: string; raw: number }
  | { kind: "empty"; value: "" };

/** Unwrap whatever exceljs produced into a plain string, without coercing meaning. */
export function readCell(raw: unknown): CellRead {
  const value = raw as CellLike;

  if (value === null || value === undefined) return { kind: "empty", value: "" };

  if (typeof value === "number") {
    // Number.toString() gives exponent form beyond 1e21; nothing legitimate in
    // this workbook is that large, and the caller rejects exponent strings.
    return { kind: "number", value: String(value), raw: value };
  }

  if (typeof value === "boolean") return { kind: "text", value: value ? "yes" : "no" };
  if (value instanceof Date) return { kind: "text", value: value.toISOString() };

  if (typeof value === "string") {
    const text = normaliseText(value);
    return text ? { kind: "text", value: text } : { kind: "empty", value: "" };
  }

  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      const joined = value.richText.map((r) => String(r?.text ?? "")).join("");
      const text = normaliseText(joined);
      return text ? { kind: "text", value: text } : { kind: "empty", value: "" };
    }
    if ("result" in value) return readCell(value.result);
    if ("text" in value) return readCell(value.text);
    if ("error" in value) return { kind: "empty", value: "" };
  }

  const text = normaliseText(String(value));
  return text ? { kind: "text", value: text } : { kind: "empty", value: "" };
}

/** Plain text cell — the common case. */
export function readText(raw: unknown): string {
  return readCell(raw).value;
}

/**
 * Issues carry a code plus parameters rather than a finished sentence: the
 * admin UI is bilingual, so the wording has to come from the message
 * catalogue at render time, not from the parser.
 */
export type IssueCode = { code: string; params?: Record<string, string | number> };

export type HsCodeRead =
  | { ok: true; value: string; warning?: IssueCode }
  | { ok: false; error: IssueCode };

/**
 * HS codes are the one field where Excel's helpfulness is destructive: a
 * 12-digit code typed into a General-formatted cell becomes a number, and a
 * code beginning with 0 (customs chapters 01–09) silently loses it. That loss
 * is unrecoverable, so a short numeric cell is rejected rather than padded —
 * guessing the missing digit would invent an HS code.
 *
 * A numeric cell that still has all 12 digits lost nothing, so it is accepted
 * with a warning telling the author to format the column as Text.
 */
export function readHsCode(raw: unknown, expectedLength: number): HsCodeRead {
  const cell = readCell(raw);
  if (cell.kind === "empty") return { ok: false, error: { code: "HS_EMPTY" } };

  const text = normaliseDigits(cell.value).replace(/\s/g, "");

  if (/e[+-]?\d+$/i.test(text)) {
    return { ok: false, error: { code: "HS_SCIENTIFIC" } };
  }

  const digits = text.replace(/\.0+$/, "");

  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: { code: "HS_NOT_DIGITS", params: { value: cell.value } } };
  }

  if (cell.kind === "number") {
    if (digits.length === expectedLength) {
      return { ok: true, value: digits, warning: { code: "HS_NUMERIC_CELL", params: { value: digits } } };
    }
    return {
      ok: false,
      error: {
        code: "HS_NUMERIC_TRUNCATED",
        params: { value: digits, found: digits.length, expected: expectedLength },
      },
    };
  }

  if (digits.length !== expectedLength) {
    return {
      ok: false,
      error: {
        code: "HS_LENGTH",
        params: { value: digits, found: digits.length, expected: expectedLength },
      },
    };
  }

  return { ok: true, value: digits };
}

const TRUEY = new Set(["yes", "y", "true", "1", "نعم"]);
const FALSEY = new Set(["no", "n", "false", "0", "لا", ""]);

/** Tolerant yes/no reader for the optional `conditional` / `active` columns. */
export function readBoolean(
  raw: unknown,
  fallback: boolean,
): { ok: true; value: boolean } | { ok: false; error: IssueCode } {
  const text = readText(raw).toLowerCase();
  if (text === "") return { ok: true, value: fallback };
  if (TRUEY.has(text)) return { ok: true, value: true };
  if (FALSEY.has(text)) return { ok: true, value: false };
  return { ok: false, error: { code: "BOOLEAN_INVALID", params: { value: text } } };
}

/** Split a multi-value cell, normalising and dropping blanks. */
export function readMultiValue(raw: unknown, separator: RegExp): string[] {
  const text = readText(raw);
  if (!text) return [];
  return text
    .split(separator)
    .map((part) => normaliseText(part))
    .filter(Boolean);
}
