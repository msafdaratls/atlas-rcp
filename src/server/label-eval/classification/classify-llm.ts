import type { LabelKbCategory } from "@prisma/client";
import { z } from "zod";
import { callStructured } from "@/server/label-eval/llm/client";
import {
  CONFIDENCE_THRESHOLD,
  type ClassificationInput,
  type ClassificationResult,
} from "@/server/label-eval/classification/classify";

/**
 * LLM-based cosmetics classification (design doc §1 Principle 4 / §0.1) — a
 * semantic alternative to classify.ts's keyword-overlap matcher, used by
 * run-cosmetics.ts only when ANTHROPIC_API_KEY is set; otherwise the
 * deterministic classify() stays the classifier. Same input/output shape as
 * classify() so the two are interchangeable at the call site.
 *
 * Critically, this still enforces classify.ts's own CONFIDENCE_THRESHOLD
 * against the model's stated confidence before accepting a category — the
 * refusal gate (Principle 4: a classifier must be able to say "no confident
 * match" rather than force-assigning the nearest category) is a
 * server-enforced check here, never something the model self-reports its
 * way past.
 */

const classificationSchema = z.object({
  categoryCode: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});

export async function classifyWithLlm(
  input: ClassificationInput,
  categories: LabelKbCategory[],
): Promise<ClassificationResult> {
  if (categories.length === 0) {
    return { categoryCode: null, confidence: 0, rationale: "No categories defined in the active dataset." };
  }

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
  if (!haystack.trim()) {
    return { categoryCode: null, confidence: 0, rationale: "No confirmed text available to classify from." };
  }

  const categoryList = categories
    .map((c) => {
      const props = (c.properties as string[] | null) ?? [];
      return `- ${c.code}: ${c.nameEn} / ${c.nameAr}${props.length ? ` (properties: ${props.join(", ")})` : ""}`;
    })
    .join("\n");

  const instructions = `Confirmed product label text:\nProduct name: EN="${input.productNameEn ?? ""}" AR="${input.productNameAr ?? ""}"\nProduct function: EN="${input.productFunctionEn ?? ""}" AR="${input.productFunctionAr ?? ""}"\nIngredients: ${input.ingredientsList ?? ""}\nFull label text: EN="${input.fullLabelTextEn ?? ""}" AR="${input.fullLabelTextAr ?? ""}"\n\nActive cosmetics category taxonomy:\n${categoryList}\n\nClassify this product into exactly one category code from the list above, or null if the product is not a cosmetic at all, or does not confidently match any listed category — never guess the nearest category just because the input is here. Give your honest confidence (0-1) that this classification is correct.`;

  // Deliberately NOT caught here: a network/rate-limit/timeout failure is an
  // infrastructure problem, not a genuine "no confident match" business
  // outcome, and the two must not be conflated into the same return shape.
  // Swallowing it here would hard-stop the pipeline into
  // BLOCKED_NO_CATEGORY_MATCH on a transient error even though the
  // deterministic keyword matcher (classify.ts) — or simply retrying — might
  // classify the product just fine. The caller (run-cosmetics.ts) catches
  // this and falls back to classify(), consistent with every other
  // AI-assisted step in this feature failing closed to its deterministic
  // equivalent rather than to a hard block.
  const parsed = await callStructured({
    scope: "label-eval.classification",
    model: process.env.LABEL_EVAL_CLAUDE_JUDGMENT_MODEL || "claude-opus-5",
    system:
      "You are a cosmetics regulatory classifier. You never force-assign the nearest category to a product that doesn't confidently belong — you say so explicitly instead.",
    content: [{ type: "text", text: instructions }],
    schema: classificationSchema,
    effort: "medium",
  });

  const knownCodes = new Set(categories.map((c) => c.code));
  if (!parsed.categoryCode || !knownCodes.has(parsed.categoryCode) || parsed.confidence < CONFIDENCE_THRESHOLD) {
    return {
      categoryCode: null,
      confidence: parsed.confidence,
      rationale: `[LLM] ${parsed.rationale || "No category matched with sufficient confidence."}`,
    };
  }

  return {
    categoryCode: parsed.categoryCode,
    confidence: parsed.confidence,
    rationale: `[LLM] ${parsed.rationale}`,
  };
}
