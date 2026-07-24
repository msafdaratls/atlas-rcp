import { EmptyState } from "@/components/atlas/empty-state";
import { ClientStatementPanel } from "@/components/atlas/finance/client-statement-panel";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { getClientStatement } from "@/server/finance/queries";
import { Receipt } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

export default async function StatementPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "finance:client", locale);

  const sp = await searchParams;
  const t = await getTranslations("finance");
  const tNav = await getTranslations("nav.client");
  const data = await getClientStatement({
    from: sp.from ?? null,
    to: sp.to ?? null,
  });

  return (
    <div>
      <PageHeader
        title={tNav("statement")}
        description={t("clientDescription")}
        breadcrumbs={[{ label: tNav("statement") }]}
      />
      {data ? (
        <ClientStatementPanel data={data} />
      ) : (
        <EmptyState
          icon={Receipt}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
        />
      )}
    </div>
  );
}
