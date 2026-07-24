import { AdminAnalyticsView } from "@/components/atlas/dashboard/admin-analytics-view";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getAdminDashboard } from "@/server/dashboard/admin-queries";
import { BarChart3 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminAnalyticsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  setRequestLocale(raw as Locale);

  const t = await getTranslations("adminOps.analytics");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const data = await getAdminDashboard();

  return (
    <div>
      <PageHeader
        title={tNav("analytics")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("analytics") }]}
      />
      {data ? (
        <div className="space-y-4">
          <p className="text-sm text-ink-500">{t("hint")}</p>
          <AdminAnalyticsView data={data} />
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
