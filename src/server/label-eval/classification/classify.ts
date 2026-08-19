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

/**
 * A stopword coincidentally unique to one category's name (e.g. "Henna
 * AND Seder" is the only category whose English name contains "and") reads
 * as maximally distinctive under the inverse-category-frequency weighting
 * below — confirmed live, "Moisturizing Shampoo" matched Henna and Seder on
 * "and" alone. Filtered at tokenize() so it never enters either side of the
 * match.
 */
const STOPWORDS = new Set([
  "and", "the", "for", "with", "are", "was", "were", "this", "that", "these",
  "those", "from", "has", "have", "its", "not", "but", "all", "can", "any",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
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

  // Dedupe each category's own tokens first — a synonym list that happens to
  // repeat a word (e.g. "hair oil", "hair cream", "hair spray" all sharing
  // "hair") must not inflate that category's hit count for a single term.
  const categoryTokenSets = categories.map((category) => ({
    category,
    tokens: [
      ...new Set(tokenize(`${category.nameEn} ${category.nameAr} ${(category.properties as string[] | null)?.join(" ") ?? ""}`)),
    ],
  }));

  // Inverse-category-frequency weighting: a token shared across many
  // categories ("hair", "products", "care") is weak evidence for any one of
  // them and must count for less than a token that's genuinely distinctive
  // of a single category ("shampoo", "toothpaste", "oud"). Confirmed live —
  // without this, "Moisturizing Shampoo" matched Hair Dyes over Hair Care
  // (Hair Dyes' smaller vocabulary gave the shared word "hair" a larger
  // share of its total), and "Diesel Engine Oil" cleared the confidence
  // threshold against Oud & Fragrance Oils purely on the generic word "oil".
  const categoryDocFreq = new Map<string, number>();
  for (const { tokens } of categoryTokenSets) {
    for (const t of tokens) categoryDocFreq.set(t, (categoryDocFreq.get(t) ?? 0) + 1);
  }
  const tokenWeight = (t: string) => 1 / (categoryDocFreq.get(t) ?? 1);

  let best: { category: LabelKbCategory; score: number } | null = null;
  for (const { category, tokens } of categoryTokenSets) {
    if (tokens.length === 0) continue;
    let hitWeight = 0;
    let totalWeight = 0;
    for (const t of tokens) {
      const w = tokenWeight(t);
      totalWeight += w;
      if (haystackTokens.has(t)) hitWeight += w;
    }
    const score = totalWeight > 0 ? hitWeight / totalWeight : 0;
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
