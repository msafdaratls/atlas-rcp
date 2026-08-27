import { registerEvaluator, type EvaluatorFn, type LookupRow } from "@/server/label-eval/evaluators/registry";
import { SFDA_FIELD_MAP, FD_2233_KEYWORD_HINTS, SFDA_BILINGUAL_CHECK_FIELDS } from "@/server/label-eval/evaluators/sfda-field-map";

/**
 * The six SFDA evaluator types (design doc §6). Registered once via
 * registerSfdaEvaluators() — call it before running the SFDA rule engine.
 */

function anyValue(field: { en?: string; ar?: string } | undefined): string | undefined {
  const v = field?.en?.trim() || field?.ar?.trim();
  return v || undefined;
}

const presence: EvaluatorFn = (ctx) => {
  const mapped = SFDA_FIELD_MAP[ctx.code];
  if (mapped) {
    for (const key of mapped) {
      const value = anyValue(ctx.fields[key]);
      if (value) {
        return { verdict: "COMPLIANT", evidenceText: value, rationale: "Confirmed field is present." };
      }
    }
    return {
      verdict: "MISSING",
      rationale: `Required field(s) not confirmed: ${mapped.join(", ")}`,
    };
  }

  const hints = FD_2233_KEYWORD_HINTS[ctx.code];
  if (hints) {
    const table = anyValue(ctx.fields["nutrition_table"]);
    if (!table) return { verdict: "MISSING", rationale: "Nutrition table not provided." };
    const hay = table.toLowerCase();
    const found = hints.some((h) => hay.includes(h.toLowerCase()));
    return found
      ? { verdict: "COMPLIANT", evidenceText: table, rationale: "Keyword match found in confirmed nutrition table text." }
      : {
          verdict: "NON_COMPLIANT",
          evidenceText: table,
          rationale: `Expected nutrient keyword (${hints.join("/")}) not found in confirmed nutrition table text.`,
        };
  }

  return {
    verdict: "NEEDS_REVIEW",
    rationale: "No automated field mapping defined for this item yet — needs manual review.",
  };
};

/** No SFDA item currently classifies as `format` (§7.1's parser never emits it) — alias to presence for forward-compatibility with future workbook revisions. */
const format: EvaluatorFn = (ctx) => presence(ctx);

const bilingualPresence: EvaluatorFn = (ctx) => {
  const missing: string[] = [];
  for (const base of SFDA_BILINGUAL_CHECK_FIELDS) {
    const en = ctx.fields[base]?.en?.trim();
    const ar = ctx.fields[base]?.ar?.trim();
    if (!en || !ar) missing.push(base);
  }
  if (missing.length === 0) {
    return { verdict: "COMPLIANT", rationale: "All bilingual fields confirmed in both Arabic and English." };
  }
  return { verdict: "MISSING", rationale: `Missing Arabic or English text for: ${missing.join(", ")}` };
};

const SECTION_TABLE_KEYS: Record<string, string[]> = {
  FD_2500: ["food_additives_category_13_6", "gmp_additives"],
  FD_2333: ["sfda_health_claims_table1", "sfda_nutrition_claims_table2"],
};

function lookupFieldValue(row: LookupRow): string | undefined {
  const p = row.payload;
  return (p.additive ?? p.healthClaim ?? p.nutritionClaim ?? p.nutrientOrSubstance ?? p.nutrientOrDescription) as
    | string
    | undefined;
}

/**
 * Fail-safe by construction (design doc §6/§7.1's gelatin rule): a miss
 * yields REQUIRES_ADDITIONAL_DATA, never COMPLIANT or NON_COMPLIANT — a
 * text-match miss could mean "not permitted" OR "matching failed on
 * naming," and this evaluator cannot tell which. Only reaches items whose
 * decisionRule is identity/permission-listing (quantity-dependent items
 * were already routed to requires_additional_data by the parser's
 * evaluatorKey classification — see sfda-parser.ts NEEDS_EXTERNAL_DATA).
 */
const lookup: EvaluatorFn = (ctx) => {
  const terms = [anyValue(ctx.fields["ingredients_list"]), anyValue(ctx.fields["claims_detected"])]
    .filter((v): v is string => !!v)
    .flatMap((v) => v.split(/[,;\n]/))
    .map((t) => t.trim())
    .filter(Boolean);

  if (terms.length === 0) {
    return {
      verdict: "REQUIRES_ADDITIONAL_DATA",
      rationale: "No confirmed ingredient/claim text to check against the active knowledge-base lookup tables.",
    };
  }

  const tableKeys = SECTION_TABLE_KEYS[ctx.section ?? ""] ?? [];
  const candidates = ctx.lookups.filter((l) => tableKeys.includes(l.tableKey));

  for (const term of terms) {
    const match = candidates.find((row) => {
      const value = lookupFieldValue(row);
      return value && value.toLowerCase().includes(term.toLowerCase());
    });
    if (match) {
      return {
        verdict: "COMPLIANT",
        evidenceText: term,
        rationale: `Matched "${term}" in the ${match.tableKey} lookup table.`,
      };
    }
  }

  return {
    verdict: "REQUIRES_ADDITIONAL_DATA",
    evidenceText: terms.join(", "),
    rationale:
      "No confirmed term matched the active knowledge-base lookup tables — this could mean the item is not permitted, or that automated name-matching failed; needs reviewer or lab confirmation rather than an automated fail.",
  };
};

/**
 * LLM-proposed judgment (design doc §1 Principle 2 / §6). When
 * getJudgmentProposals (run-sfda.ts) has a proposal for this rule code, it is
 * returned verbatim — the caller stamps autoOrManual: "llm_proposed" plus
 * llmModel/llmPromptVersion when writing it, and a reviewer must still
 * confirm or override it via "Change assessment". Falls back to the original
 * static NEEDS_REVIEW when no proposal exists (ANTHROPIC_API_KEY unset, or
 * this batch's LLM call failed).
 */
const wordingJudgment: EvaluatorFn = (ctx) => {
  const proposal = ctx.llmProposals[ctx.code];
  if (proposal) {
    return { verdict: proposal.verdict, evidenceText: proposal.evidenceText, rationale: proposal.rationale };
  }
  return {
    verdict: "NEEDS_REVIEW",
    rationale:
      (ctx.payload.commonNonConformities as string | undefined) ??
      "This item requires human judgment (LLM-assisted proposal not configured or unavailable — design doc §1 Principle 2). Review the confirmed label text against the item's guidance and select a verdict.",
  };
};

const requiresAdditionalData: EvaluatorFn = (ctx) => ({
  verdict: "REQUIRES_ADDITIONAL_DATA",
  rationale:
    (ctx.payload.evidenceRequired as string | undefined) ??
    (ctx.payload.decisionRule as string | undefined) ??
    "Requires formulation, lab, or dossier data not available from the label artwork alone.",
});

let registered = false;
export function registerSfdaEvaluators(): void {
  if (registered) return;
  registered = true;
  registerEvaluator("presence", presence);
  registerEvaluator("format", format);
  registerEvaluator("bilingual_presence", bilingualPresence);
  registerEvaluator("lookup", lookup);
  registerEvaluator("wording_judgment", wordingJudgment);
  registerEvaluator("requires_additional_data", requiresAdditionalData);
}
