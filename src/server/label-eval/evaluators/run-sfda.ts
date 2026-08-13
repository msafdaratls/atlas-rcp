import { recommendDecision } from "@/lib/assessment";
import { prisma } from "@/lib/db";
import { registerSfdaEvaluators } from "@/server/label-eval/evaluators/sfda";
import { runEvaluator, type ConfirmedFields } from "@/server/label-eval/evaluators/registry";

export type RunResult = {
  overallRate: number | null;
  finalVerdict: "accepted" | "accepted_with_remarks" | "rejected" | "incomplete";
  compliant: number;
  nonCompliant: number;
  na: number;
  needsReview: number;
  requiresAdditionalData: number;
};

/**
 * Runs the full SFDA rule engine over an assessment's CONFIRMED fields only
 * (design doc §1 Principle 3 — unconfirmed fields are never read here), then
 * scores via the exact existing formula (src/lib/assessment.ts, already live
 * for the manual checklist) rather than reimplementing it.
 */
export async function runSfdaRuleEngine(assessmentId: string): Promise<RunResult> {
  registerSfdaEvaluators();

  const assessment = await prisma.labelAssessment.findUniqueOrThrow({
    where: { id: assessmentId },
    select: {
      id: true,
      kbVersionId: true,
      fields: { select: { fieldKey: true, valueEn: true, valueAr: true, confirmedAt: true } },
    },
  });

  const confirmedFields: ConfirmedFields = {};
  for (const f of assessment.fields) {
    if (!f.confirmedAt) continue; // unconfirmed fields never reach the engine
    confirmedFields[f.fieldKey] = { en: f.valueEn ?? undefined, ar: f.valueAr ?? undefined };
  }

  const [rules, lookupRows] = await Promise.all([
    prisma.labelKbRule.findMany({ where: { kbVersionId: assessment.kbVersionId } }),
    prisma.labelKbLookup.findMany({ where: { kbVersionId: assessment.kbVersionId } }),
  ]);
  const lookups = lookupRows.map((l) => ({ tableKey: l.tableKey, payload: l.payload as Record<string, unknown> }));

  let compliant = 0;
  let nonCompliant = 0;
  let na = 0;
  let needsReview = 0;
  let requiresAdditionalData = 0;

  await prisma.$transaction(
    rules.map((rule) => {
      const result = runEvaluator(rule.evaluatorKey, {
        code: rule.code,
        section: rule.section,
        titleEn: rule.titleEn,
        titleAr: rule.titleAr,
        payload: rule.payload as Record<string, unknown>,
        fields: confirmedFields,
        classification: null, // SFDA has no classifier
        lookups,
      });

      switch (result.verdict) {
        case "COMPLIANT": compliant++; break;
        case "NON_COMPLIANT": nonCompliant++; break;
        case "NA": na++; break;
        case "NEEDS_REVIEW": needsReview++; break;
        case "REQUIRES_ADDITIONAL_DATA": requiresAdditionalData++; break;
      }

      return prisma.labelItemVerdict.upsert({
        where: { assessmentId_kbRuleId: { assessmentId, kbRuleId: rule.id } },
        create: {
          assessmentId,
          kbRuleId: rule.id,
          verdict: result.verdict,
          autoOrManual: "auto",
          evidenceText: result.evidenceText,
          rationale: result.rationale,
        },
        update: {
          verdict: result.verdict,
          autoOrManual: "auto",
          evidenceText: result.evidenceText,
          rationale: result.rationale,
        },
      });
    }),
  );

  const rate = compliant + nonCompliant === 0 ? null : compliant / (compliant + nonCompliant);
  // "Complete" per src/lib/assessment.ts semantics: every item resolved to
  // compliant/nonCompliant/na. NEEDS_REVIEW and REQUIRES_ADDITIONAL_DATA are
  // provisional — the reviewer must resolve them before a firm decision.
  const complete = needsReview === 0 && requiresAdditionalData === 0;
  const decision = recommendDecision(rate, complete);

  const finalVerdict =
    decision === "ACCEPTED" ? "accepted" :
    decision === "ACCEPTED_WITH_REMARKS" ? "accepted_with_remarks" :
    decision === "REJECTED" ? "rejected" : "incomplete";

  await prisma.labelAssessment.update({
    where: { id: assessmentId },
    data: { overallRate: rate, finalVerdict },
  });

  return { overallRate: rate, finalVerdict, compliant, nonCompliant, na, needsReview, requiresAdditionalData };
}
