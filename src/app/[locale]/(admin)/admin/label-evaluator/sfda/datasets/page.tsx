import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { KbDatasetsPanel } from "@/components/atlas/label-eval/kb-datasets-panel";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { listKbVersions } from "@/server/label-eval/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SfdaDatasetsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "catalogue:manage", locale);

  const t = await getTranslations("labelEval.datasets");
  const tNav = await getTranslations("nav.admin");
  const versions = (await listKbVersions("SFDA_SUPPLEMENTS")) ?? [];

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        breadcrumbs={[
          { label: tNav("labelEvalSfda"), href: `/${locale}/admin/label-evaluator/sfda` },
          { label: t("title") },
        ]}
      />
      <KbDatasetsPanel domain="SFDA_SUPPLEMENTS" versions={versions} />
    </div>
  );
}
