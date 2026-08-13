import type { LabelKbCategory } from "@prisma/client";

/**
 * Cosmetics classification (design doc §1 Principle 4 / §0.1). No LLM is
 * wired for this yet (same honest-default policy as extraction — see
 * ManualEntryProvider) — this is a deterministic keyword-overlap matcher
 * against the active KB version's LabelKbCategory rows. It is deliberately
 * conservative: below CONFIDENCE_THRESHOLD it returns no match rather than
 * guessing, which is the direct fix for the bug found live in
 * cosmetics.atls.com.sa/tool (a supplement was force-classified into "Oral
 * Care" because the tool had no "not applicable" outcome — design doc §0.1).
 */

export type ClassificationInput = {
  productNameEn?: string;
  productNameAr?: string;
  productFunctionEn?: string;
  productFunctionAr?: string;
  ingredientsList?: string;
  fullLabelTextEn?: string;
  fullLabelTextAr?: string;
};

export type ClassificationResult = {
  categoryCode: string | null;
  confidence: number;
  rationale: string;
};

const CONFIDENCE_THRESHOLD = 0.15;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

export function classify(input: ClassificationInput, categories: LabelKbCategory[]): ClassificationResult {
  const haystack = [
    input.productNameEn,
    input.productNameAr,
    input.productFunctionEn,
    input.productFunctionAr,
    input.ingredientsList,
    input.fullLabelTextEn,
    input.fullLabelTextAr,
  ]
    .filter(Boolean)
    .join(" ");
  const haystackTokens = new Set(tokenize(haystack));

  if (haystackTokens.size === 0 || categories.length === 0) {
    return {
      categoryCode: null,
      confidence: 0,
      rationale: categories.length === 0
        ? "No categories defined in the active dataset."
        : "No confirmed text available to classify from.",
    };
  }

  let best: { category: LabelKbCategory; score: number } | null = null;
  for (const category of categories) {
    const categoryTokens = tokenize(`${category.nameEn} ${category.nameAr} ${(category.properties as string[] | null)?.join(" ") ?? ""}`);
    if (categoryTokens.length === 0) continue;
    const hits = categoryTokens.filter((t) => haystackTokens.has(t)).length;
    const score = hits / categoryTokens.length;
    if (!best || score > best.score) best = { category, score };
  }

  if (!best || best.score < CONFIDENCE_THRESHOLD) {
    return {
      categoryCode: null,
      confidence: best?.score ?? 0,
      rationale: "No category matched with sufficient confidence — this product may not be a cosmetic, or its category isn't represented in the active dataset. Never force-assigning the nearest category (design doc §1 Principle 4).",
    };
  }

  return {
    categoryCode: best.category.code,
    confidence: best.score,
    rationale: `Matched "${best.category.nameEn}" on confirmed product name/function/label text (confidence ${Math.round(best.score * 100)}%).`,
  };
}
