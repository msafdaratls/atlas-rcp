import { AdminRequestsTable } from "@/components/atlas/admin/admin-requests-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { checkPermission } from "@/lib/rbac";
import { listAdminRequests } from "@/server/admin/queries";
import { ClipboardList } from "lucide-react";
import { ADMIN_QUEUE_STATES } from "@/server/admin/queries";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
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
  const canCreateOnBehalf = checkPermission(session, "requests:create-behalf");

  const sp = await searchParams;
  const t = await getTranslations("adminOps.requests");
  const tNav = await getTranslations("nav.admin");
  const tQueues = await getTranslations("dashboard.admin.queues");
  const activeQueue =
    sp.queue && sp.queue in ADMIN_QUEUE_STATES
      ? (sp.queue as keyof typeof ADMIN_QUEUE_STATES)
      : null;
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
        breadcrumbs={
          activeQueue
            ? [
                { label: tNav("workQueues"), href: `/${locale}/admin/queues` },
                { label: tQueues(activeQueue) },
              ]
            : [{ label: tNav("requests") }]
        }
        actions={
          canCreateOnBehalf ? (
            <Button asChild>
              <Link href={`/${locale}/admin/requests/new`}>
                {t("newRequest")}
              </Link>
            </Button>
          ) : undefined
        }
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
