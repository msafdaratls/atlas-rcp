import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminAuditView } from "@/components/atlas/admin/admin-audit-view";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAuditLogView } from "@/server/admin/audit-queries";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; action?: string; entityType?: string }>;
};

export default async function AdminAuditPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "audit:read", locale);

  const sp = await searchParams;
  const filters = {
    action: sp.action || undefined,
    entityType: sp.entityType || undefined,
  };
  const data = await getAuditLogView({
    page: sp.page ? Number(sp.page) : 1,
    ...filters,
  });

  const t = await getTranslations("adminOps.audit");
  const tNav = await getTranslations("nav.admin");

  return (
    <div>
      <PageHeader
        title={tNav("audit")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("audit") }]}
      />
      <AdminAuditView data={data} locale={locale} filters={filters} />
    </div>
  );
}
