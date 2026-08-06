import Link from "next/link";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { EngagementActions } from "@/components/atlas/admin/engagement-actions";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getEngagementDetail } from "@/server/admin/engagements";
import { Briefcase } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function AdminEngagementDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const t = await getTranslations("adminOps.engagements");
  const tNav = await getTranslations("nav.admin");
  const engagement = await getEngagementDetail(id);

  if (!engagement) {
    return (
      <EmptyState
        icon={Briefcase}
        title={t("notFoundTitle")}
        description={t("notFoundDescription")}
      />
    );
  }

  const clientName =
    locale === "ar" ? engagement.organisation.nameAr : engagement.organisation.nameEn;
  const serviceName =
    locale === "ar" ? engagement.serviceItem.nameAr : engagement.serviceItem.nameEn;

  return (
    <div className="space-y-6">
      <PageHeader
        title={clientName}
        description={serviceName}
        breadcrumbs={[
          { label: tNav("engagements"), href: `/${locale}/admin/engagements` },
          { label: clientName },
        ]}
        actions={
          <EngagementActions
            engagementId={engagement.id}
            status={engagement.status}
            organisationId={engagement.organisation.id}
            locale={locale}
          />
        }
      />

      {engagement.notes ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">{t("notes")}</h2>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{engagement.notes}</p>
        </div>
      ) : null}

      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          {t("linkedRequests")} ({engagement.requestCount})
        </h2>
        {engagement.requests.length === 0 ? (
          <p className="text-sm text-ink-500">{t("noRequests")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {engagement.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <Link
                  href={`/${locale}/admin/requests/${r.id}`}
                  className="text-sm font-medium text-atlas-green hover:underline"
                >
                  {r.requestNo}
                </Link>
                <span className="text-xs text-ink-500">{r.state}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
