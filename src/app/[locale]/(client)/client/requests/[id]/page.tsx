import { ClientRequestDetailPanel } from "@/components/atlas/requests/client-request-detail";
import { PageHeader } from "@/components/atlas/page-header";
import { RequestNumber } from "@/components/atlas/request-number";
import { StateBadge } from "@/components/atlas/state-badge";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { getClientRequestDetail } from "@/server/requests/queries";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function RequestDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "requests:read", locale);

  const t = await getTranslations("requestDetail");
  const tNav = await getTranslations("nav.client");
  const data = await getClientRequestDetail(id);
  if (!data) notFound();

  return (
    <div>
      <PageHeader
        title={data.items
          .map((i) => (locale === "ar" ? i.productNameAr : i.productNameEn))
          .join(", ")}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("myRequests"), href: `/${locale}/client/requests` },
          { label: data.requestNo },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <RequestNumber value={data.requestNo} />
            <StateBadge state={data.state} />
          </div>
        }
      />
      <ClientRequestDetailPanel data={data} />
    </div>
  );
}
