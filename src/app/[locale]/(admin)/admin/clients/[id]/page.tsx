import { AdminClientDetailPanel } from "@/components/atlas/admin/admin-client-detail";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getAdminClientDetail } from "@/server/admin/queries";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; id: string }> };

export default async function AdminClientDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "clients:read", locale);

  const t = await getTranslations("adminOps.clientDetail");
  const tNav = await getTranslations("nav.admin");
  const data = await getAdminClientDetail(id);
  if (!data) notFound();

  return (
    <div>
      <PageHeader
        title={locale === "ar" ? data.nameAr : data.nameEn}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("clients"), href: `/${locale}/admin/clients` },
          { label: locale === "ar" ? data.nameAr : data.nameEn },
        ]}
      />
      <AdminClientDetailPanel data={data} />
    </div>
  );
}
