import { FileSearch } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/atlas/empty-state";
import { NeedsEvaluationTable } from "@/components/atlas/label-eval/needs-evaluation-table";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { checkPermission } from "@/lib/rbac";
import { listNeedsEvaluation } from "@/server/label-eval/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SfdaEvaluatorQueuePage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);
  const canManageDatasets = checkPermission(session, "catalogue:manage");

  const t = await getTranslations("labelEval.queue");
  const tDatasets = await getTranslations("labelEval.datasets");
  const tNav = await getTranslations("nav.admin");
  const rows = await listNeedsEvaluation("SFDA_SUPPLEMENTS");

  return (
    <div>
      <PageHeader
        title={tNav("labelEvalSfda")}
        description={t("description")}
        breadcrumbs={[{ label: tNav("labelEvalSfda") }]}
        actions={
          canManageDatasets ? (
            <Button asChild variant="outline">
              <Link href={`/${locale}/admin/label-evaluator/sfda/datasets`}>{tDatasets("title")}</Link>
            </Button>
          ) : undefined
        }
      />
      {rows && rows.length > 0 ? (
        <NeedsEvaluationTable rows={rows} domain="SFDA_SUPPLEMENTS" />
      ) : (
        <EmptyState icon={FileSearch} title={t("empty")} description={t("emptyDescription")} />
      )}
    </div>
  );
}
