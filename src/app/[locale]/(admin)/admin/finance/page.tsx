import { EmptyState } from "@/components/atlas/empty-state";
import { AdminFinancePanel } from "@/components/atlas/finance/admin-finance-panel";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAdminFinanceView } from "@/server/finance/queries";
import { Landmark } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminFinancePage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "finance:admin", locale);

  const t = await getTranslations("finance");
  const tNav = await getTranslations("nav.admin");
  const data = await getAdminFinanceView();

  return (
    <div>
      <PageHeader
        title={tNav("finance")}
        description={t("adminDescription")}
        breadcrumbs={[{ label: tNav("finance") }]}
      />
      {data ? (
        <AdminFinancePanel data={data} />
      ) : (
        <EmptyState
          icon={Landmark}
          title={t("unavailableTitle")}
          description={t("adminUnavailableDescription")}
        />
      )}
    </div>
  );
}
