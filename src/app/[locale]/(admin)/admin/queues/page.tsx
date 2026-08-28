import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { ADMIN_QUEUE_STATES, getAdminQueueStats } from "@/server/admin/queries";
import {
  ArrowRightLeft,
  Gavel,
  Inbox,
  LayoutList,
  PauseCircle,
  ScanSearch,
  Undo2,
} from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

const QUEUE_ICONS: Record<keyof typeof ADMIN_QUEUE_STATES, typeof Inbox> = {
  intake: Inbox,
  assessment: ScanSearch,
  technical: LayoutList,
  decision: Gavel,
  returned: Undo2,
  onHold: PauseCircle,
};

const QUEUE_ACCENTS: Record<keyof typeof ADMIN_QUEUE_STATES, string> = {
  intake: "text-sky-600 bg-sky-50",
  assessment: "text-amber-600 bg-amber-50",
  technical: "text-violet-600 bg-violet-50",
  decision: "text-atlas-green-600 bg-atlas-green-50",
  returned: "text-orange-600 bg-orange-50",
  onHold: "text-ink-500 bg-ink-100",
};

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
  const stats = await getAdminQueueStats();
  const keys = Object.keys(ADMIN_QUEUE_STATES) as Array<keyof typeof ADMIN_QUEUE_STATES>;
  const total = stats ? keys.reduce((sum, key) => sum + stats[key].depth, 0) : 0;

  return (
    <div>
      <PageHeader
        title={tNav("workQueues")}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("dashboard"), href: `/${locale}/admin` },
          { label: tNav("workQueues") },
        ]}
        actions={
          stats ? (
            <div className="flex items-baseline gap-2 rounded-lg border border-line bg-surface px-4 py-2">
              <span className="font-data text-2xl font-bold text-ink-900" dir="ltr">
                {total}
              </span>
              <span className="text-xs text-ink-500">{t("total")}</span>
            </div>
          ) : undefined
        }
      />
      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((key) => {
            const Icon = QUEUE_ICONS[key];
            const { depth, atRisk } = stats[key];
            return (
              <Link
                key={key}
                href={`/${locale}/admin/requests?queue=${key}`}
                className="group relative flex flex-col justify-between gap-4 overflow-hidden rounded-xl border border-line bg-surface p-5 shadow-elevation transition-all duration-150 ease-out hover:-translate-y-0.5 hover:border-atlas-green hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg ${QUEUE_ACCENTS[key]}`}
                  >
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <ArrowRightLeft
                    className="size-4 shrink-0 -rotate-90 text-ink-300 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 rtl:rotate-90"
                    aria-hidden
                  />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink-900 group-hover:text-atlas-green-600">
                    {tQueues(key)}
                  </p>
                  <p className="mt-1 font-data text-3xl font-bold text-ink-900" dir="ltr">
                    {depth}
                  </p>
                </div>
                {atRisk > 0 ? (
                  <p className="font-data text-xs font-semibold text-state-bad">
                    {t("atRisk", { count: atRisk })}
                  </p>
                ) : (
                  <p className="text-xs text-ink-500">{t("atRiskNone")}</p>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={LayoutList} title={t("empty")} description={t("pageDescription")} />
      )}
    </div>
  );
}
