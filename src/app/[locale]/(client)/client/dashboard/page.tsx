import { ClientDashboard } from "@/components/atlas/dashboard/client-dashboard";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getClientDashboard } from "@/server/dashboard/client-queries";
import { FilePlus2, LayoutDashboard, Receipt } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ denied?: string }>;
};

export default async function ClientDashboardPage({
  params,
  searchParams,
}: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const sp = await searchParams;
  const showDenied = sp.denied === "1";

  const t = await getTranslations("nav.client");
  const tDash = await getTranslations("dashboard.client");
  const data = await getClientDashboard();
  const financeOnly = data?.mode === "finance";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("dashboard")}
        description={
          financeOnly
            ? tDash("financePageDescription")
            : tDash("pageDescription")
        }
        breadcrumbs={[{ label: t("dashboard") }]}
        actions={
          financeOnly ? (
            <Button asChild>
              <Link href={`/${locale}/client/statement`}>
                <Receipt className="size-4" />
                {tDash("viewStatement")}
              </Link>
            </Button>
          ) : (
            <Button asChild>
              <Link href={`/${locale}/client/requests/new`}>
                <FilePlus2 className="size-4" />
                {t("newRequest")}
              </Link>
            </Button>
          )
        }
      />
      {showDenied ? (
        <div
          className="rounded-lg border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-4"
          role="alert"
        >
          <h2 className="text-sm font-semibold text-state-warn">
            {tDash("accessDenied.title")}
          </h2>
          <p className="mt-1 text-sm text-ink-800">
            {tDash("accessDenied.body")}
          </p>
        </div>
      ) : null}
      {data ? (
        <ClientDashboard data={data} locale={locale} />
      ) : (
        <EmptyState
          icon={LayoutDashboard}
          title={tDash("unavailableTitle")}
          description={tDash("unavailableDescription")}
          action={
            <Button asChild>
              <Link href={`/${locale}/client/statement`}>
                {tDash("viewStatement")}
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
