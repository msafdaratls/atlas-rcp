import { prisma } from "@/lib/db";
import { classify } from "@/server/label-eval/classification/classify";
import { registerCosmeticsEvaluators } from "@/server/label-eval/evaluators/cosmetics";
import { runEvaluator, type ConfirmedFields } from "@/server/label-eval/evaluators/registry";

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
  const existingOverride = assessment.classification?.overrideCategoryCode;
  const auto = classify(
    {
      productNameEn: confirmedFields.product_name?.en,
      productNameAr: confirmedFields.product_name?.ar,
      productFunctionEn: confirmedFields.product_function?.en,
      productFunctionAr: confirmedFields.product_function?.ar,
      ingredientsList: confirmedFields.ingredients_list?.en,
      fullLabelTextEn: confirmedFields.full_label_text?.en,
      fullLabelTextAr: confirmedFields.full_label_text?.ar,
    },
    categories,
  );
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
    }),
  }));

  await prisma.$transaction(
    results.map(({ rule, result }) =>
      prisma.labelItemVerdict.upsert({
        where: { assessmentId_kbRuleId: { assessmentId, kbRuleId: rule.id } },
        create: { assessmentId, kbRuleId: rule.id, verdict: result.verdict, autoOrManual: "auto", evidenceText: result.evidenceText, rationale: result.rationale },
        update: { verdict: result.verdict, autoOrManual: "auto", evidenceText: result.evidenceText, rationale: result.rationale },
      }),
    ),
  );

  // Required tests (design doc §6/§9) — deterministic, category+properties
  // triggered, no LLM. Produces LabelRequiredTest rows, not verdicts.
  const testRules = await prisma.labelKbRule.findMany({
    where: { kbVersionId: assessment.kbVersionId, ruleType: "REQUIRED_TEST_RULE" },
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
