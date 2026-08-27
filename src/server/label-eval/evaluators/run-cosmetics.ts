import { log } from "@/lib/logger";
import { prisma } from "@/lib/db";
import { classify } from "@/server/label-eval/classification/classify";
import { classifyWithLlm } from "@/server/label-eval/classification/classify-llm";
import type { ClassificationResult } from "@/server/label-eval/classification/classify";
import { registerCosmeticsEvaluators } from "@/server/label-eval/evaluators/cosmetics";
import { runEvaluator, type ConfirmedFields } from "@/server/label-eval/evaluators/registry";
import { getJudgmentProposals } from "@/server/label-eval/llm/judgment-proposals";

/**
 * Workflow doc §13 final-status vocabulary — NOT SFDA's (accepted /
 * accepted_with_remarks / rejected / incomplete). "conditionally_compliant"
 * is deliberately never assigned here: the doc's §12 frames it as something
 * the Technical Reviewer decides, not something derivable from verdict
 * counts alone (unlike "requires_review", which just means something is
 * still unresolved). Setting it is a separate, not-yet-built manual action —
 * scoped out of this pass because it needs its own field so a later item
 * override doesn't silently recompute over a reviewer's manual call.
 */
export type CosmeticsFinalVerdict = "compliant" | "non_compliant" | "requires_review" | "conditionally_compliant";

export type RunCosmeticsResult =
  | { blocked: true }
  | {
      blocked: false;
      finalVerdict: CosmeticsFinalVerdict;
      compliant: number;
      nonCompliant: number;
      needsReview: number;
    };

/**
 * Any real NON_COMPLIANT is a hard fail (matches the doc's "Non-Compliant").
 * Otherwise, anything still unresolved (NEEDS_REVIEW or
 * REQUIRES_ADDITIONAL_DATA) means the assessment isn't actually done yet —
 * "Requires Review", not a false-confident pass. Only once everything is
 * resolved clean does it become "Compliant".
 */
function scoreCosmeticsVerdicts(verdicts: { verdict: string }[]): {
  finalVerdict: CosmeticsFinalVerdict;
  compliant: number;
  nonCompliant: number;
  needsReview: number;
} {
  let compliant = 0;
  let nonCompliant = 0;
  let needsReview = 0;
  for (const { verdict } of verdicts) {
    if (verdict === "COMPLIANT") compliant++;
    else if (verdict === "NON_COMPLIANT") nonCompliant++;
    else if (verdict === "NEEDS_REVIEW" || verdict === "REQUIRES_ADDITIONAL_DATA") needsReview++;
  }
  const finalVerdict: CosmeticsFinalVerdict =
    nonCompliant > 0 ? "non_compliant" : needsReview > 0 ? "requires_review" : "compliant";
  return { finalVerdict, compliant, nonCompliant, needsReview };
}

/**
 * Runs the cosmetics classification + rule engine (design doc §2 step 4-6).
 * Classification runs first and can HARD-STOP the pipeline
 * (BLOCKED_NO_CATEGORY_MATCH) — this is the direct fix for the live-tool bug
 * in design doc §0.1, where a non-cosmetic was force-classified and fully
 * evaluated under the wrong standard. claim_phase_judgment items are only
 * evaluated once a category is confirmed, never against a guessed one.
 */
export async function runCosmeticsRuleEngine(assessmentId: string): Promise<RunCosmeticsResult> {
  registerCosmeticsEvaluators();

  const assessment = await prisma.labelAssessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      id: true,
      kbVersionId: true,
      fields: { select: { fieldKey: true, valueEn: true, valueAr: true, confirmedAt: true } },
      classification: true,
    },
  });

  const confirmedFields: ConfirmedFields = {};
  for (const f of assessment.fields) {
    if (!f.confirmedAt) continue;
    confirmedFields[f.fieldKey] = { en: f.valueEn ?? undefined, ar: f.valueAr ?? undefined };
  }

  const categories = await prisma.labelKbCategory.findMany({ where: { kbVersionId: assessment.kbVersionId } });

  // Step 4: classify (or use the reviewer's manual override if one was set).
  // LLM classification (classify-llm.ts) is used when ANTHROPIC_API_KEY is
  // set; otherwise the deterministic keyword matcher (classify.ts) — same
  // fail-closed pattern as everywhere else in this feature. Both enforce the
  // identical CONFIDENCE_THRESHOLD gate, so the "no confident match"
  // refusal (design doc §1 Principle 4) is never weaker under the AI path.
  // A *transient* LLM failure (network/rate-limit/timeout) is caught here
  // and falls back to the deterministic matcher rather than hard-stopping
  // into BLOCKED_NO_CATEGORY_MATCH — that failure mode is an infrastructure
  // problem, not a genuine "no confident match", and must not be treated
  // as one.
  const existingOverride = assessment.classification?.overrideCategoryCode;
  const classificationInput = {
    productNameEn: confirmedFields.product_name?.en,
    productNameAr: confirmedFields.product_name?.ar,
    productFunctionEn: confirmedFields.product_function?.en,
    productFunctionAr: confirmedFields.product_function?.ar,
    ingredientsList: confirmedFields.ingredients_list?.en,
    fullLabelTextEn: confirmedFields.full_label_text?.en,
    fullLabelTextAr: confirmedFields.full_label_text?.ar,
  };
  let auto: ClassificationResult;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      auto = await classifyWithLlm(classificationInput, categories);
    } catch (error) {
      log.warn("label-eval.classification", "LLM classification failed — falling back to keyword matcher", {
        assessmentId,
        error: error instanceof Error ? error.message : "unknown",
      });
      auto = classify(classificationInput, categories);
    }
  } else {
    auto = classify(classificationInput, categories);
  }
  const resolvedCategoryCode = existingOverride ?? auto.categoryCode;

  await prisma.labelClassification.upsert({
    where: { assessmentId },
    create: {
      assessmentId,
      detectedCategoryCode: auto.categoryCode,
      detectedConfidence: auto.confidence,
      notApplicable: auto.categoryCode === null,
      rationale: auto.rationale,
    },
    update: {
      detectedCategoryCode: auto.categoryCode,
      detectedConfidence: auto.confidence,
      notApplicable: auto.categoryCode === null && !existingOverride,
      rationale: auto.rationale,
    },
  });

  if (!resolvedCategoryCode) {
    await prisma.labelAssessment.update({ where: { id: assessmentId }, data: { status: "BLOCKED_NO_CATEGORY_MATCH" } });
    return { blocked: true };
  }

  const category = categories.find((c) => c.code === resolvedCategoryCode) ?? null;
  const classification = { categoryCode: resolvedCategoryCode, properties: (category?.properties as string[] | null) ?? [] };

  // CLAIM_PHASE_ITEM rules are intentionally NOT filtered by
  // classification.categoryCode here, even though every claim row carries a
  // `productCategory` in its payload (cosmetics-parser.ts CLAIMS_COL) and it
  // looks like an obvious filter to add. Checked the real imported KB
  // (2026-08 audit): the Claims sheet's `productCategory` uses its OWN
  // 5-value taxonomy (سكن/شعر/فم/نظافة نسائية/General) — a different axis
  // from the 16-code product classification taxonomy this file's `classify()`
  // assigns (see cosmetics-parser.ts's own comment on that split). Crucially,
  // "النظافة النسائية" (Feminine Hygiene) has NO corresponding classification
  // category at all, so filtering on categoryCode would make every Feminine
  // Hygiene claim permanently unmatched — hiding it from every product,
  // forever, not just narrowing noise. That's a worse defect than the noise
  // it would fix (a missed compliance claim vs. a few extra rows to skim), so
  // this stays unfiltered until a real crosswalk between the two taxonomies
  // is defined (product/compliance decision, not one to guess at in code).
  const [rules, lookupRows] = await Promise.all([
    prisma.labelKbRule.findMany({
      where: { kbVersionId: assessment.kbVersionId, ruleType: { in: ["LABEL_REQUIREMENT_ITEM", "CLAIM_PHASE_ITEM"] } },
    }),
    prisma.labelKbLookup.findMany({ where: { kbVersionId: assessment.kbVersionId } }),
  ]);
  const lookups = lookupRows.map((l) => ({ tableKey: l.tableKey, payload: l.payload as Record<string, unknown> }));

  // AI-proposed claim judgments (design doc §1 Principle 2 / §6) — one
  // batched call covering every claim_phase_judgment item, fetched once
  // before the evaluator loop. Only reached once a category is CONFIRMED
  // (this line runs after the BLOCKED_NO_CATEGORY_MATCH early-return above),
  // never against a guessed classification. Returns {} when
  // ANTHROPIC_API_KEY is unset, a pure no-op when unconfigured.
  const judgmentRules = rules.filter((r) => r.evaluatorKey === "claim_phase_judgment");
  const llmProposals = await getJudgmentProposals("COSMETICS", confirmedFields, judgmentRules);

  const results = rules.map((rule) => ({
    rule,
    result: runEvaluator(rule.evaluatorKey, {
      code: rule.code,
      section: rule.section,
      titleEn: rule.titleEn,
      titleAr: rule.titleAr,
      payload: rule.payload as Record<string, unknown>,
      fields: confirmedFields,
      classification,
      lookups,
      llmProposals,
    }),
  }));

  await prisma.$transaction(
    results.map(({ rule, result }) => {
      const proposal = llmProposals[rule.code];
      return prisma.labelItemVerdict.upsert({
        where: { assessmentId_kbRuleId: { assessmentId, kbRuleId: rule.id } },
        create: {
          assessmentId,
          kbRuleId: rule.id,
          verdict: result.verdict,
          autoOrManual: proposal ? "llm_proposed" : "auto",
          evidenceText: result.evidenceText,
          rationale: result.rationale,
          llmModel: proposal?.model ?? null,
          llmPromptVersion: proposal?.promptVersion ?? null,
        },
        update: {
          verdict: result.verdict,
          autoOrManual: proposal ? "llm_proposed" : "auto",
          evidenceText: result.evidenceText,
          rationale: result.rationale,
          // `?? null`, not just `proposal?.model`: on `update`, Prisma
          // treats an `undefined` field value as "leave unchanged," not
          // "clear it." Without the `?? null`, a rule that had an LLM
          // proposal on a prior run (llmModel stamped) but has none on a
          // re-run (key removed, batch call failed) would keep the stale
          // llmModel/llmPromptVersion even though autoOrManual correctly
          // flips back to "auto" — a misleading audit trail.
          llmModel: proposal?.model ?? null,
          llmPromptVersion: proposal?.promptVersion ?? null,
        },
      });
    }),
  );

  // Required tests (design doc §6/§9) — deterministic, category+properties
  // triggered, no LLM. Produces LabelRequiredTest rows, not verdicts.
  await applyRequiredTests(assessmentId, assessment.kbVersionId, classification);

  const score = scoreCosmeticsVerdicts(results.map((r) => r.result));
  await prisma.labelAssessment.update({
    where: { id: assessmentId },
    data: { status: "ASSESSED", finalVerdict: score.finalVerdict },
  });

  return { blocked: false, ...score };
}

/**
 * Recomputes and stores LabelAssessment.finalVerdict from whatever
 * LabelItemVerdict rows exist right now, without re-running the classifier
 * or evaluators. Mirrors recomputeSfdaScore (run-sfda.ts) — call after
 * applyVerdictOverride so the summary bar doesn't go stale (see that
 * function's comment for the confirmed live bug this fixes).
 */
export async function recomputeCosmeticsScore(assessmentId: string): Promise<void> {
  const verdicts = await prisma.labelItemVerdict.findMany({
    where: { assessmentId },
    select: { verdict: true },
  });
  const { finalVerdict } = scoreCosmeticsVerdicts(verdicts);
  await prisma.labelAssessment.update({ where: { id: assessmentId }, data: { finalVerdict } });
}

/**
 * Rebuilds an assessment's auto-triggered LabelRequiredTest rows from the KB's
 * REQUIRED_TEST_RULEs for a given classification. Deterministic — no LLM, no
 * evaluators — which is why the manual route (which runs no rule engine at
 * all) calls it too rather than reimplementing the trigger logic.
 * Manually-added tests (`addedManually`) are never touched.
 */
export async function applyRequiredTests(
  assessmentId: string,
  kbVersionId: string,
  classification: { categoryCode: string; properties: string[] },
): Promise<void> {
  const testRules = await prisma.labelKbRule.findMany({
    where: { kbVersionId, ruleType: "REQUIRED_TEST_RULE" },
  });
  await prisma.labelRequiredTest.deleteMany({ where: { assessmentId, addedManually: false } });
  const triggered = testRules.filter((r) => {
    const p = r.payload as { triggerCategoryCode?: string; triggerProperty?: string };
    if (p.triggerCategoryCode && p.triggerCategoryCode === classification.categoryCode) return true;
    // triggerProperty never fires today: cosmetics-parser.ts's
    // parseRequiredTests deliberately never sets it. Only "Mandatory" rows
    // (keyed on Product Category alone) get a working trigger key —
    // "Conditional" rows (the ones a property-based trigger would cover)
    // need a reviewer to judge applicability, since there's no
    // per-assessment sub-type detector yet to safely auto-fire them. Kept
    // here as forward-compatible plumbing for when that detector exists,
    // not dead code to delete — see the parser's own comment for the full
    // reasoning (same "don't guess at the wrong dimension" rule this
    // codebase applies consistently to conditional KB rows).
    if (p.triggerProperty && classification.properties.includes(p.triggerProperty)) return true;
    return false;
  });
  if (triggered.length > 0) {
    await prisma.labelRequiredTest.createMany({
      data: triggered.map((r) => {
        const p = r.payload as { testCode?: string; mandatory?: boolean; reasonEn?: string; reasonAr?: string; triggerSource?: string };
        return {
          assessmentId,
          testCode: p.testCode ?? r.titleEn ?? r.code,
          mandatory: p.mandatory ?? true,
          ruleCode: r.code,
          reasonEn: p.reasonEn,
          reasonAr: p.reasonAr,
          triggerSource: p.triggerSource,
        };
      }),
    });
  }
}
