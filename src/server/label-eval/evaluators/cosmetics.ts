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

/**
 * `fieldKey` is a single string for most rules, but several real GSO 1943
 * items check a compound condition across two fields (e.g. "product name
 * AND trademark", "expiry date OR PAO") — `matchMode` ("all", the default,
 * or "any") disambiguates AND vs OR. Single-key rules behave exactly as
 * before (an array of length 1 with the default "all" mode is trivially the
 * same check).
 */
const labelPresence: EvaluatorFn = (ctx) => {
  const rawKey = ctx.payload.fieldKey as string | string[] | undefined;
  if (!rawKey) {
    return { verdict: "NEEDS_REVIEW", rationale: "This rule has no fieldKey mapping in the active dataset — needs manual review." };
  }
  const keys = Array.isArray(rawKey) ? rawKey : [rawKey];
  const matchMode = (ctx.payload.matchMode as "all" | "any" | undefined) ?? "all";
  const values = keys.map((key) => ({ key, value: anyValue(ctx.fields[key]) }));
  const satisfied = matchMode === "any" ? values.some((v) => v.value) : values.every((v) => v.value);

  if (satisfied) {
    const evidence = values.filter((v) => v.value).map((v) => v.value).join("; ");
    return { verdict: "COMPLIANT", evidenceText: evidence, rationale: "Confirmed field(s) present." };
  }
  const missing = values.filter((v) => !v.value).map((v) => v.key).join(", ");
  return { verdict: "MISSING", rationale: `Required field(s) "${missing}" not confirmed.` };
};

/**
 * Presence plus a literal substring check (`payload.formatPattern`,
 * case-insensitive) against the confirmed field text — e.g. the "Ingredients"
 * header word must literally appear before the INCI list. Falls back to a
 * plain presence check when no rule in the active dataset defines a pattern
 * yet, so this stays backward-compatible as more patterns are added.
 */
const labelFormat: EvaluatorFn = (ctx) => {
  const pattern = ctx.payload.formatPattern as string | undefined;
  if (!pattern) return labelPresence(ctx);

  const fieldKey = ctx.payload.fieldKey as string | undefined;
  if (!fieldKey) {
    return { verdict: "NEEDS_REVIEW", rationale: "This rule has no fieldKey mapping in the active dataset — needs manual review." };
  }
  const value = anyValue(ctx.fields[fieldKey]);
  if (!value) {
    return { verdict: "MISSING", rationale: `Required field "${fieldKey}" is not confirmed.` };
  }
  if (value.toLowerCase().includes(pattern.toLowerCase())) {
    return { verdict: "COMPLIANT", evidenceText: value, rationale: `Found required text "${pattern}".` };
  }
  return { verdict: "NON_COMPLIANT", evidenceText: value, rationale: `Required text "${pattern}" not found in the confirmed field.` };
};

/**
 * Fail-safe default for label rules that check something the label artwork
 * alone can't answer — formulation composition, lab data, or a
 * packaging-format-conditional exemption (design doc §7.2 audit). Mirrors
 * SFDA's evaluator of the same name (evaluators/sfda.ts) exactly.
 */
const requiresAdditionalData: EvaluatorFn = (ctx) => ({
  verdict: "REQUIRES_ADDITIONAL_DATA",
  rationale:
    (ctx.payload.explanation as string | undefined) ??
    "Requires formulation, lab, or dossier data not available from the label artwork alone.",
});

/**
 * LLM-proposed claim judgment (design doc §1 Principle 2 / §6). When
 * getJudgmentProposals (run-cosmetics.ts) has a proposal for this rule code,
 * it is returned verbatim — the caller stamps autoOrManual: "llm_proposed"
 * plus llmModel/llmPromptVersion when writing it, and a reviewer must still
 * confirm or override it via "Change assessment". Falls back to the original
 * static NEEDS_REVIEW when no proposal exists (ANTHROPIC_API_KEY unset, or
 * this batch's LLM call failed). Gated on a CONFIRMED category by the caller
 * (run-cosmetics.ts) before this ever runs — never evaluated, LLM-assisted
 * or not, against a guessed/unconfirmed classification.
 */
const claimPhaseJudgment: EvaluatorFn = (ctx) => {
  const proposal = ctx.llmProposals[ctx.code];
  if (proposal) {
    return { verdict: proposal.verdict, evidenceText: proposal.evidenceText, rationale: proposal.rationale };
  }
  return {
    verdict: "NEEDS_REVIEW",
    rationale:
      (ctx.payload.explanation as string | undefined) ??
      "This claim requires human judgment against the active claims framework (LLM-assisted proposal not configured or unavailable).",
  };
};

const COSING_PROHIBITED_TABLE = "cosing_annex_ii";
const COSING_RESTRICTED_TABLE = "cosing_annex_iii";

function lookupIngredientName(payload: Record<string, unknown>): string | undefined {
  return (payload.ingredient ?? payload.name ?? payload.substance) as string | undefined;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word substring match, not a plain `.includes()`. Confirmed live: a
 * real, distinct ingredient "Toluene-2,5-Diamine" plain-substring-matched
 * the unrelated Annex II entry "4-Methoxytoluene-2,5-diamine and its HCl
 * salt..." — the entry name merely happens to contain the shorter term as
 * a run of characters mid-word ("methoxyTOLUENE..."), not as a distinct
 * substance reference. `\b` requires a real word boundary on both sides, so
 * a term fused onto a preceding word prefix (no space/hyphen break) no
 * longer counts as a match, while an exact or genuinely space/punctuation-
 * delimited match still does.
 */
function containsWholeTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  return new RegExp(`\\b${escapeRegex(term.toLowerCase())}\\b`, "i").test(haystack.toLowerCase());
}

/**
 * COSING Annex II/III entries are written as narrow, conditional bans, not
 * plain substance names — e.g. "Alanroot oil (CAS No 97676-35-2), when used
 * as a fragrance ingredient" or "Paraffin waxes (coal), ..., if they
 * contain > 0.005% w/w benzo[a]pyrene". Confirmed live: whole-word matching
 * a generic declared ingredient like "Fragrance" or "Paraffin" against the
 * FULL entry text hits the qualifier clause's own generic wording, not the
 * actual prohibited substance, producing a false NON_COMPLIANT on ordinary,
 * permitted ingredients. Strip the parenthetical CAS/EC annotation and the
 * trailing ", when used as .../if it contains .../unless .../except ..."
 * qualifier clause so only the actual substance name remains for matching.
 */
function coreSubstanceName(entryName: string): string {
  const noParens = entryName.replace(/\([^)]*\)/g, " ");
  const noQualifier = noParens.split(
    /,\s*(?:when used|if\s+(?:it|they|used|present)|unless|except|for use|in\s+(?:the\s+)?(?:absence|presence)|only\s+when)/i,
  )[0];
  return noQualifier.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * A declared ingredient matches an Annex entry if either name contains the
 * other as a whole phrase — but for a single-word term (no internal
 * whitespace, e.g. "Fragrance", "Paraffin"), require an exact match against
 * the cleaned core substance name rather than mere whole-word containment.
 * A single generic word is too easy to find somewhere inside a longer,
 * unrelated substance name (see coreSubstanceName above); multi-word terms
 * are specific enough that phrase containment stays safe.
 */
function matchesAnnexEntry(entryName: string, term: string): boolean {
  const normTerm = term.trim().toLowerCase();
  if (!normTerm) return false;
  const core = coreSubstanceName(entryName);
  if (!core) return false;
  if (/\s/.test(normTerm)) {
    return containsWholeTerm(core, normTerm) || containsWholeTerm(normTerm, core);
  }
  return normTerm === core;
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
export const ingredientLookup: EvaluatorFn = (ctx) => {
  const ingredientsText = anyValue(ctx.fields["ingredients_list"]);
  if (!ingredientsText) {
    return { verdict: "NEEDS_REVIEW", rationale: "No confirmed ingredient list to screen." };
  }
  // Split on comma/semicolon/newline, EXCEPT a comma immediately followed by
  // a digit — INCI/IUPAC names routinely carry locant numbering with an
  // internal comma ("Toluene-2,5-Diamine", "1,4-Dioxane"). Confirmed live:
  // the naive split fragmented "Toluene-2,5-Diamine" into "Toluene-2" and
  // "5-Diamine", and the truncated "Toluene-2" fragment coincidentally
  // substring-matched an unrelated real Annex II entry name — a spurious
  // NON_COMPLIANT on a plausible correctly-spelled ingredient.
  const terms = ingredientsText.split(/[;\n]|,(?!\d)/).map((t) => t.trim()).filter(Boolean);

  for (const term of terms) {
    const prohibited = ctx.lookups.find(
      (l) => l.tableKey === COSING_PROHIBITED_TABLE && matchesAnnexEntry(lookupIngredientName(l.payload) ?? "", term),
    );
    if (prohibited) {
      return { verdict: "NON_COMPLIANT", evidenceText: term, rationale: `"${term}" matches a COSING Annex II (prohibited) entry.` };
    }
  }
  for (const term of terms) {
    const restricted = ctx.lookups.find(
      (l) => l.tableKey === COSING_RESTRICTED_TABLE && matchesAnnexEntry(lookupIngredientName(l.payload) ?? "", term),
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
  registerEvaluator("requires_additional_data", requiresAdditionalData);
}
