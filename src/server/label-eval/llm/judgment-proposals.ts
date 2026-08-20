import type { LabelEvalDomain, LabelKbRule, LabelVerdict } from "@prisma/client";
import { z } from "zod";
import { callStructured } from "@/server/label-eval/llm/client";
import type { ConfirmedFields } from "@/server/label-eval/evaluators/registry";

/**
 * LLM-proposed judgment verdicts (design doc §1 Principle 2 / §6). Proposes,
 * never decides: the returned map is consumed by wordingJudgment
 * (evaluators/sfda.ts) and claimPhaseJudgment (evaluators/cosmetics.ts),
 * which return it verbatim as the evaluator's result; the caller
 * (run-sfda.ts/run-cosmetics.ts) then stores it as `autoOrManual:
 * "llm_proposed"` with llmModel/llmPromptVersion stamped. A reviewer must
 * still confirm or override every item via the existing "Change assessment"
 * control before it can be promoted to the official checklist — nothing here
 * writes a final verdict.
 */

export type JudgmentProposal = {
  verdict: LabelVerdict;
  evidenceText?: string;
  rationale: string;
  model: string;
  promptVersion: string;
};

/** Bump whenever the prompt below changes — stamped onto every proposal for audit (design doc §5/§11). */
const PROMPT_VERSION = "judgment-v1";

const VERDICT_VALUES = ["COMPLIANT", "NON_COMPLIANT", "NA", "NEEDS_REVIEW", "REQUIRES_ADDITIONAL_DATA"] as const;

const proposalSchema = z.object({
  proposals: z.array(
    z.object({
      code: z.string(),
      verdict: z.enum(VERDICT_VALUES),
      rationale: z.string(),
      evidenceText: z.string().nullable(),
    }),
  ),
});

/** Defensive batch cap — keeps one call bounded even if a future KB revision adds many more judgment items than SFDA/Cosmetics have today. */
const MAX_RULES_PER_CALL = 40;

/** Exported for direct unit testing — pure string-formatting logic, no network involved. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function fieldsToText(fields: ConfirmedFields): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, NonNullable<ConfirmedFields[string]>] => {
      const v = entry[1];
      return !!v && !!(v.en?.trim() || v.ar?.trim());
    })
    .map(([key, v]) => `${key}: EN="${v.en ?? ""}" AR="${v.ar ?? ""}"`);
  return lines.join("\n");
}

export function ruleGuidanceText(rule: LabelKbRule): string {
  const payload = rule.payload as Record<string, unknown>;
  const guidance = [payload.compliantWhen, payload.commonNonConformities, payload.evidenceRequired, payload.explanation, payload.decisionRule]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" | ");
  const section = rule.section ? ` (section ${rule.section})` : "";
  return `[${rule.code}] ${rule.titleEn ?? ""} / ${rule.titleAr}${section}${guidance ? `\nGuidance: ${guidance}` : ""}`;
}

export async function getJudgmentProposals(
  domain: LabelEvalDomain,
  confirmedFields: ConfirmedFields,
  judgmentRules: LabelKbRule[],
): Promise<Record<string, JudgmentProposal>> {
  if (!process.env.ANTHROPIC_API_KEY || judgmentRules.length === 0) return {};

  const model = process.env.LABEL_EVAL_CLAUDE_JUDGMENT_MODEL || "claude-opus-5";
  const fieldText = fieldsToText(confirmedFields);
  const domainLabel = domain === "SFDA_SUPPLEMENTS" ? "SFDA supplement label" : "cosmetics label/claims";
  const results: Record<string, JudgmentProposal> = {};

  for (const batch of chunk(judgmentRules, MAX_RULES_PER_CALL)) {
    const rulesText = batch.map(ruleGuidanceText).join("\n\n");
    const instructions = `Confirmed label text (from a human-verified extraction):\n${fieldText || "(no confirmed text)"}\n\nFor each of the following ${domainLabel} compliance items, propose a verdict against the confirmed label text above. Only use COMPLIANT or NON_COMPLIANT when the confirmed text above genuinely settles the question either way. Use NEEDS_REVIEW whenever the confirmed text is ambiguous, missing, or the call genuinely needs a human. Use NA when the item plainly does not apply to this product. Use REQUIRES_ADDITIONAL_DATA when the item needs information (formulation, lab data, dossier) that is not on the label at all. Always give a short rationale, and where you answer COMPLIANT or NON_COMPLIANT, quote the exact evidence text you relied on.\n\nItems:\n${rulesText}`;

    let parsed: z.infer<typeof proposalSchema>;
    try {
      parsed = await callStructured({
        scope: "label-eval.judgment",
        model,
        system:
          "You are a bilingual (Arabic/English) regulatory-compliance reviewer proposing verdicts for a human reviewer to confirm. You are never the final decision-maker — when genuinely unsure, answer NEEDS_REVIEW rather than guessing.",
        content: [{ type: "text", text: instructions }],
        schema: proposalSchema,
        effort: "high",
      });
    } catch {
      // A failed batch simply yields no proposals for its rules — the
      // existing NEEDS_REVIEW fallback in wordingJudgment/claimPhaseJudgment
      // applies, exactly as if the LLM were never configured.
      continue;
    }

    const knownCodes = new Set(batch.map((r) => r.code));
    for (const p of parsed.proposals) {
      if (!knownCodes.has(p.code)) continue; // ignore anything the model invented
      results[p.code] = {
        verdict: p.verdict,
        rationale: p.rationale,
        evidenceText: p.evidenceText ?? undefined,
        model,
        promptVersion: PROMPT_VERSION,
      };
    }
  }

  return results;
}
