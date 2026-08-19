/**
 * Marker labels identifying an Evaluation Report `RequestDocument` (no
 * `activityId`/`requiredDocumentId` — a request-item-level document distinct
 * from activity reports and client-submitted required documents). Mirrors the
 * `${activity.type} report` label convention `uploadActivityReport` already
 * uses to distinguish document purpose without a dedicated column.
 *
 * Single source of truth shared between `src/server/admin/actions.ts`
 * (`hasEvaluationReportForAllItems`'s server-side gate — the actual
 * enforcement) and `evaluation-report-panel.tsx` (the upload UI it drives).
 * Previously duplicated in both files; kept as one plain module (no
 * "use server"/"use client") so both sides can import it directly instead of
 * two copies that could silently drift apart.
 */
export const DEFAULT_EVALUATION_REPORT_LABEL = "Evaluation Report";

/**
 * Most services need one generic "Evaluation Report" upload before Complete
 * Evaluation. Cosmetic SCOC (SFDA-COS-002) needs 3 specifically-named
 * documents instead — keyed by ServiceItem.code so every other service keeps
 * today's single-label behavior unchanged.
 */
const EVALUATION_REPORT_LABELS: Record<string, string[]> = {
  "SFDA-COS-002": ["Evaluation Check List", "Inspection Report", "Test Report"],
};

export function evaluationReportLabelsFor(serviceCode: string): string[] {
  return EVALUATION_REPORT_LABELS[serviceCode] ?? [DEFAULT_EVALUATION_REPORT_LABEL];
}
