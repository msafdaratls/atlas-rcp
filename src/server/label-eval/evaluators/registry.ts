import type { LabelVerdict } from "@prisma/client";
import type { JudgmentProposal } from "@/server/label-eval/llm/judgment-proposals";

/**
 * Evaluator registry (design doc §6). Every evaluator reads ONLY the
 * confirmed fields passed in — never re-derives from raw artwork (design
 * doc §1 Principle 3). `fields` keys are fieldKeys from
 * src/server/label-eval/fields.ts (bilingual fields carry `_en`/`_ar` suffixes).
 */

/** One entry per fieldKey — mirrors LabelExtractedField, which carries both languages on one row. */
export type ConfirmedFields = Record<string, { en?: string; ar?: string } | undefined>;

export type LookupRow = { tableKey: string; payload: Record<string, unknown> };

export type RuleContext = {
  code: string;
  section: string | null;
  titleEn: string | null;
  titleAr: string;
  payload: Record<string, unknown>;
  fields: ConfirmedFields;
  classification: { categoryCode?: string; properties?: string[] } | null;
  lookups: LookupRow[];
  /** Rule code -> LLM-proposed verdict (design doc §1 Principle 2), pre-fetched once per run and threaded through exactly like `lookups`. Empty when ANTHROPIC_API_KEY is unset. */
  llmProposals: Record<string, JudgmentProposal>;
};

export type EvaluatorResult = {
  verdict: LabelVerdict;
  evidenceText?: string;
  rationale?: string;
};

export type EvaluatorFn = (ctx: RuleContext) => EvaluatorResult;

const registry = new Map<string, EvaluatorFn>();

export function registerEvaluator(key: string, fn: EvaluatorFn): void {
  registry.set(key, fn);
}

export function runEvaluator(evaluatorKey: string, ctx: RuleContext): EvaluatorResult {
  const fn = registry.get(evaluatorKey);
  if (!fn) {
    return {
      verdict: "NEEDS_REVIEW",
      rationale: `No evaluator registered for key "${evaluatorKey}" — needs manual review.`,
    };
  }
  return fn(ctx);
}
