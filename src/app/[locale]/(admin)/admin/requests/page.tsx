import { AdminRequestsTable } from "@/components/atlas/admin/admin-requests-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { listAdminRequests } from "@/server/admin/queries";
import { ClipboardList } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{
    q?: string;
    state?: string;
    queue?: string;
    page?: string;
  }>;
};

export default async function AdminRequestsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const sp = await searchParams;
  const t = await getTranslations("adminOps.requests");
  const tNav = await getTranslations("nav.admin");
  const data = await listAdminRequests({
    q: sp.q ?? null,
    state: sp.state ?? null,
    queue: sp.queue ?? null,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <div>
      <PageHeader
        title={tNav("requests")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("requests") }]}
      />
      {data ? (
        <Suspense fallback={null}>
          <AdminRequestsTable
            rows={data.rows}
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            q={sp.q ?? ""}
            state={sp.state ?? "ALL"}
            queue={sp.queue ?? ""}
          />
        </Suspense>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={t("empty")}
          description={t("pageDescription")}
        />
      )}
    </div>
  );
}
