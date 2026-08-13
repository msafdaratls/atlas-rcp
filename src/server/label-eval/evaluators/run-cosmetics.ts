import { prisma } from "@/lib/db";
import { classify } from "@/server/label-eval/classification/classify";
import { registerCosmeticsEvaluators } from "@/server/label-eval/evaluators/cosmetics";
import { runEvaluator, type ConfirmedFields } from "@/server/label-eval/evaluators/registry";

export type RunCosmeticsResult =
  | { blocked: true }
  | {
      blocked: false;
      finalVerdict: "compliant" | "non_compliant";
      compliant: number;
      nonCompliant: number;
      needsReview: number;
    };

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

  const [rules, lookupRows] = await Promise.all([
    prisma.labelKbRule.findMany({
      where: { kbVersionId: assessment.kbVersionId, ruleType: { in: ["LABEL_REQUIREMENT_ITEM", "CLAIM_PHASE_ITEM"] } },
    }),
    prisma.labelKbLookup.findMany({ where: { kbVersionId: assessment.kbVersionId } }),
  ]);
  const lookups = lookupRows.map((l) => ({ tableKey: l.tableKey, payload: l.payload as Record<string, unknown> }));

  let compliant = 0;
  let nonCompliant = 0;
  let needsReview = 0;

  await prisma.$transaction(
    rules.map((rule) => {
      const result = runEvaluator(rule.evaluatorKey, {
        code: rule.code,
        section: rule.section,
        titleEn: rule.titleEn,
        titleAr: rule.titleAr,
        payload: rule.payload as Record<string, unknown>,
        fields: confirmedFields,
        classification,
        lookups,
      });

      if (result.verdict === "COMPLIANT") compliant++;
      else if (result.verdict === "NON_COMPLIANT") nonCompliant++;
      else needsReview++;

      return prisma.labelItemVerdict.upsert({
        where: { assessmentId_kbRuleId: { assessmentId, kbRuleId: rule.id } },
        create: { assessmentId, kbRuleId: rule.id, verdict: result.verdict, autoOrManual: "auto", evidenceText: result.evidenceText, rationale: result.rationale },
        update: { verdict: result.verdict, autoOrManual: "auto", evidenceText: result.evidenceText, rationale: result.rationale },
      });
    }),
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

  // Scoring — DECISION PENDING (design doc §8.2): any NON_COMPLIANT label
  // item fails the whole assessment. This is the stricter of the two
  // options the design doc lists, matching what was observed live (2
  // non-compliant items -> non-compliant overall). Kept as a single,
  // swappable check so the product-owner decision can change this without a
  // schema change.
  const finalVerdict = nonCompliant > 0 ? "non_compliant" : "compliant";
  await prisma.labelAssessment.update({
    where: { id: assessmentId },
    data: { status: "ASSESSED", finalVerdict },
  });

  return { blocked: false, finalVerdict, compliant, nonCompliant, needsReview };
}
