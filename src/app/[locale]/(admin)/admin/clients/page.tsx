import { AdminClientsTable } from "@/components/atlas/admin/admin-clients-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { listAdminClients } from "@/server/admin/queries";
import { Building2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function AdminClientsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "clients:read", locale);

  const sp = await searchParams;
  const t = await getTranslations("adminOps.clients");
  const tNav = await getTranslations("nav.admin");
  const data = await listAdminClients({
    q: sp.q ?? null,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <div>
      <PageHeader
        title={tNav("clients")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("clients") }]}
      />
      {data ? (
        <Suspense fallback={null}>
          <AdminClientsTable
            rows={data.rows}
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            q={sp.q ?? ""}
          />
        </Suspense>
      ) : (
        <EmptyState
          icon={Building2}
          title={t("empty")}
          description={t("pageDescription")}
        />
      )}
    </div>
  );
}
