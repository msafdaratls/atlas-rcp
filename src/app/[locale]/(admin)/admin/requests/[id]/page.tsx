import { AdminRequestDetailPanel } from "@/components/atlas/admin/admin-request-detail";
import { PageHeader } from "@/components/atlas/page-header";
import { RequestNumber } from "@/components/atlas/request-number";
import { StateBadge } from "@/components/atlas/state-badge";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAdminRequestDetail, listAssignableStaff } from "@/server/admin/queries";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function AdminRequestDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const t = await getTranslations("adminOps.requestDetail");
  const tNav = await getTranslations("nav.admin");
  const [data, staff] = await Promise.all([
    getAdminRequestDetail(id),
    listAssignableStaff(),
  ]);
  if (!data) notFound();

  return (
    <div>
      <PageHeader
        title={locale === "ar" ? data.productNameAr : data.productNameEn}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("requests"), href: `/${locale}/admin/requests` },
          { label: data.requestNo },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <RequestNumber value={data.requestNo} />
            <StateBadge state={data.state} />
          </div>
        }
      />
      <AdminRequestDetailPanel data={data} assignableStaff={staff ?? []} />
    </div>
  );
}
