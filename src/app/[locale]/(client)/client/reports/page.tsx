import { ClientReportsTable } from "@/components/atlas/reports/client-reports-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { listClientReports } from "@/server/requests/queries";
import { FileText } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; year?: string; page?: string }>;
};

export default async function ReportsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "requests:read", locale);

  const sp = await searchParams;
  const t = await getTranslations("reports");
  const tNav = await getTranslations("nav.client");
  const year = sp.year ? Number(sp.year) : new Date().getFullYear();
  const data = await listClientReports({
    q: sp.q ?? null,
    year,
    page: sp.page ? Number(sp.page) : 1,
  });
  const years = [year, year - 1, year - 2];

  return (
    <div>
      <PageHeader
        title={tNav("reports")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("reports") }]}
      />
      {data ? (
        <Suspense fallback={null}>
          <ClientReportsTable
            rows={data.rows}
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            q={sp.q ?? ""}
            year={year}
            years={years}
          />
        </Suspense>
      ) : (
        <EmptyState
          icon={FileText}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
        />
      )}
    </div>
  );
}
