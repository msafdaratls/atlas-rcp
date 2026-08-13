import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AssessmentWorkspace } from "@/components/atlas/label-eval/assessment-workspace";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAssessmentDetail } from "@/server/label-eval/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; assessmentId: string }> };

export default async function SfdaAssessmentPage({ params }: Props) {
  const { locale: raw, assessmentId } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const detail = await getAssessmentDetail(assessmentId);
  if (!detail || detail.domain !== "SFDA_SUPPLEMENTS") notFound();

  const t = await getTranslations("labelEval.workspace");
  const tNav = await getTranslations("nav.admin");

  return (
    <div>
      <PageHeader
        title={`${detail.requestNo} — ${detail.organisationName}`}
        description={t("kbVersionLabel", { version: detail.kbVersionLabel })}
        breadcrumbs={[
          { label: tNav("labelEvalSfda"), href: `/${locale}/admin/label-evaluator/sfda` },
          { label: detail.requestNo },
        ]}
      />
      <AssessmentWorkspace detail={detail} domain="SFDA_SUPPLEMENTS" />
    </div>
  );
}
