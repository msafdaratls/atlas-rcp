import { registerEvaluator, type EvaluatorFn } from "@/server/label-eval/evaluators/registry";

/**
 * Cosmetics evaluator types (design doc §6). Unlike SFDA's evaluators
 * (sfda.ts), there is no hardcoded rule-code -> field-key map here — there
 * are no real cosmetics rule codes to map against yet (no workbook, design
 * doc §7.2/§12). Instead these evaluators read `rule.payload.fieldKey`
 * generically, a value the cosmetics parser sets at import time. This is
 * the correct pattern for a domain whose rule set doesn't exist yet; once
 * real cosmetics rule codes exist, whether to also curate a hand-built map
 * (SFDA's approach) is a decision for that point, not this one.
 */

function anyValue(field: { en?: string; ar?: string } | undefined): string | undefined {
  const v = field?.en?.trim() || field?.ar?.trim();
  return v || undefined;
}

const labelPresence: EvaluatorFn = (ctx) => {
  const fieldKey = ctx.payload.fieldKey as string | undefined;
  if (!fieldKey) {
    return { verdict: "NEEDS_REVIEW", rationale: "This rule has no fieldKey mapping in the active dataset — needs manual review." };
  }
  const value = anyValue(ctx.fields[fieldKey]);
  if (value) return { verdict: "COMPLIANT", evidenceText: value, rationale: "Confirmed field is present." };
  return { verdict: "NON_COMPLIANT", rationale: `Required field "${fieldKey}" is not confirmed.` };
};

/** No cosmetics item currently defines a format regex in the payload — alias to presence until one does. */
const labelFormat: EvaluatorFn = (ctx) => labelPresence(ctx);

/**
 * LLM-proposed claim judgment (design doc §1 Principle 2 / §6). No LLM is
 * wired yet (same honest-default as extraction/SFDA wording_judgment) — this
 * always returns NEEDS_REVIEW rather than fabricating a semantic judgment.
 * Gated on a CONFIRMED category by the caller (run-cosmetics.ts) before this
 * ever runs — never evaluated against a guessed/unconfirmed classification.
 */
const claimPhaseJudgment: EvaluatorFn = (ctx) => ({
  verdict: "NEEDS_REVIEW",
  rationale:
    (ctx.payload.explanation as string | undefined) ??
    "This claim requires human (or future LLM-assisted) judgment against the active claims framework.",
});

const COSING_PROHIBITED_TABLE = "cosing_annex_ii";
const COSING_RESTRICTED_TABLE = "cosing_annex_iii";

function lookupIngredientName(payload: Record<string, unknown>): string | undefined {
  return (payload.ingredient ?? payload.name ?? payload.substance) as string | undefined;
}

/**
 * COSING ingredient screen. Unlike SFDA's permitted-list `lookup` evaluator
 * (a miss is ambiguous, so it fails safe to REQUIRES_ADDITIONAL_DATA), this
 * is a PROHIBITED/RESTRICTED-list screen — the live cosmetics tool's own
 * behavior confirms a miss here is a genuine pass ("No prohibited or
 * restricted ingredients detected"), not a data gap. A match against Annex
 * II (prohibited) is a hard NON_COMPLIANT; Annex III (restricted) needs a
 * human look at the usage conditions.
 */
const ingredientLookup: EvaluatorFn = (ctx) => {
  const ingredientsText = anyValue(ctx.fields["ingredients_list"]);
  if (!ingredientsText) {
    return { verdict: "NEEDS_REVIEW", rationale: "No confirmed ingredient list to screen." };
  }
  const terms = ingredientsText.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);

  for (const term of terms) {
    const prohibited = ctx.lookups.find(
      (l) => l.tableKey === COSING_PROHIBITED_TABLE && lookupIngredientName(l.payload)?.toLowerCase().includes(term.toLowerCase()),
    );
    if (prohibited) {
      return { verdict: "NON_COMPLIANT", evidenceText: term, rationale: `"${term}" matches a COSING Annex II (prohibited) entry.` };
    }
  }
  for (const term of terms) {
    const restricted = ctx.lookups.find(
      (l) => l.tableKey === COSING_RESTRICTED_TABLE && lookupIngredientName(l.payload)?.toLowerCase().includes(term.toLowerCase()),
    );
    if (restricted) {
      return { verdict: "NEEDS_REVIEW", evidenceText: term, rationale: `"${term}" matches a COSING Annex III (restricted) entry — verify usage conditions are met.` };
    }
  }
  return { verdict: "COMPLIANT", evidenceText: terms.join(", "), rationale: "No prohibited or restricted ingredients detected in the confirmed list." };
};

let registered = false;
export function registerCosmeticsEvaluators(): void {
  if (registered) return;
  registered = true;
  registerEvaluator("label_presence", labelPresence);
  registerEvaluator("label_format", labelFormat);
  registerEvaluator("claim_phase_judgment", claimPhaseJudgment);
  registerEvaluator("ingredient_lookup", ingredientLookup);
}
