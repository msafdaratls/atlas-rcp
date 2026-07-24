import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { ADMIN_QUEUE_STATES, getAdminQueueCounts } from "@/server/admin/queries";
import { LayoutList } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminQueuesPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const t = await getTranslations("adminOps.queues");
  const tNav = await getTranslations("nav.admin");
  const tQueues = await getTranslations("dashboard.admin.queues");
  const counts = await getAdminQueueCounts();

  return (
    <div>
      <PageHeader
        title={tNav("workQueues")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("workQueues") }]}
      />
      {counts ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(ADMIN_QUEUE_STATES) as Array<keyof typeof ADMIN_QUEUE_STATES>).map(
            (key) => (
              <Link
                key={key}
                href={`/${locale}/admin/requests?queue=${key}`}
                className="group flex flex-col justify-between gap-3 rounded-lg border border-line bg-surface p-5 transition-colors duration-150 ease-out hover:border-atlas-green"
              >
                <p className="text-sm font-semibold text-ink-900 group-hover:text-atlas-green-600">
                  {tQueues(key)}
                </p>
                <p className="font-data text-3xl font-bold text-ink-900" dir="ltr">
                  {counts[key]}
                </p>
              </Link>
            ),
          )}
        </div>
      ) : (
        <EmptyState icon={LayoutList} title={t("empty")} description={t("pageDescription")} />
      )}
    </div>
  );
}
