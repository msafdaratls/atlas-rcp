import { ClientRequestsTable } from "@/components/atlas/requests/client-requests-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { listClientRequests } from "@/server/requests/queries";
import { ClipboardList, FilePlus2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; state?: string; page?: string }>;
};

export default async function MyRequestsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "requests:read", locale);

  const sp = await searchParams;
  const t = await getTranslations("myRequests");
  const tNav = await getTranslations("nav.client");
  const data = await listClientRequests({
    q: sp.q ?? null,
    state: sp.state ?? null,
    page: sp.page ? Number(sp.page) : 1,
  });

  return (
    <div>
      <PageHeader
        title={tNav("myRequests")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("myRequests") }]}
        actions={
          <Button asChild>
            <Link href={`/${locale}/client/requests/new`}>
              <FilePlus2 className="size-4" />
              {tNav("newRequest")}
            </Link>
          </Button>
        }
      />
      {data ? (
        <Suspense fallback={null}>
          <ClientRequestsTable
            rows={data.rows}
            page={data.page}
            pageSize={data.pageSize}
            pageCount={data.pageCount}
            q={sp.q ?? ""}
            state={sp.state ?? "ALL"}
          />
        </Suspense>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
          action={
            <Button asChild>
              <Link href={`/${locale}/client/requests/new`}>
                {tNav("newRequest")}
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
