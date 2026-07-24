import { AdminDashboard } from "@/components/atlas/dashboard/admin-dashboard";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getAdminDashboard } from "@/server/dashboard/admin-queries";
import { LayoutDashboard } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ denied?: string }>;
};

export default async function AdminHomePage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const sp = await searchParams;
  const showDenied = sp.denied === "1";

  const t = await getTranslations("dashboard.admin");
  const tOps = await getTranslations("adminOps");
  const data = await getAdminDashboard();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: t("title") }]}
      />
      {showDenied ? (
        <div
          className="rounded-lg border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-4"
          role="alert"
        >
          <h2 className="text-sm font-semibold text-state-warn">
            {tOps("accessDenied.title")}
          </h2>
          <p className="mt-1 text-sm text-ink-800">{tOps("accessDenied.body")}</p>
        </div>
      ) : null}
      {data ? (
        <AdminDashboard data={data} />
      ) : (
        <EmptyState
          icon={LayoutDashboard}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
        />
      )}
    </div>
  );
}
