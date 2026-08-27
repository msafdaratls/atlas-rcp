import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AssessmentWorkspace } from "@/components/atlas/label-eval/assessment-workspace";
import { ManualAssessmentWorkspace } from "@/components/atlas/label-eval/manual-assessment-workspace";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAssessmentDetail } from "@/server/label-eval/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; assessmentId: string }> };

/**
 * The manual evaluation page — deliberately its own route, off the request
 * page: a hand-worked assessment is a full compliance checklist against the
 * KB, not a panel bolted onto request administration.
 *
 * Once the evaluator completes the run it is an ordinary ASSESSED assessment,
 * so this page hands over to the shared AssessmentWorkspace rather than
 * duplicating the results view and its promote-to-official-checklist action.
 */
export default async function ManualAssessmentPage({ params }: Props) {
  const { locale: raw, assessmentId } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const detail = await getAssessmentDetail(assessmentId);
  // AI runs have their own per-domain routes; serving one here would show it
  // under a "manual assessment" heading it never earned.
  if (!detail || detail.method !== "MANUAL") notFound();

  const t = await getTranslations("labelEval.manual");
  const tWorkspace = await getTranslations("labelEval.workspace");
  const tNav = await getTranslations("nav.admin");
  const queueBasePath = detail.domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics";
  const queueLabel = detail.domain === "SFDA_SUPPLEMENTS"
    ? tNav("labelEvalSfda")
    : tNav("labelEvalCosmetics");

  return (
    <div>
      <PageHeader
        title={`${detail.requestNo} — ${detail.organisationName}`}
        description={`${t("pageDescription")} · ${tWorkspace("kbVersionLabel", { version: detail.kbVersionLabel })}`}
        breadcrumbs={[
          { label: queueLabel, href: `/${locale}/admin/label-evaluator/${queueBasePath}` },
          { label: detail.requestNo },
        ]}
      />
      {detail.status === "MANUAL_IN_PROGRESS" ? (
        <ManualAssessmentWorkspace detail={detail} />
      ) : (
        <AssessmentWorkspace detail={detail} domain={detail.domain} />
      )}
    </div>
  );
}
