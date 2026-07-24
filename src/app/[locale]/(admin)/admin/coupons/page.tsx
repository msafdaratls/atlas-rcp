import { AdminCouponsTable } from "@/components/atlas/admin/admin-coupons-table";
import { CreateCouponForm } from "@/components/atlas/admin/create-coupon-form";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import {
  getCouponCreateOptions,
  listAdminCoupons,
} from "@/server/admin/queries";
import { Ticket } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminCouponsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "coupons:manage", locale);

  const t = await getTranslations("adminOps.coupons");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const [coupons, options] = await Promise.all([
    listAdminCoupons(),
    getCouponCreateOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={tNav("coupons")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("coupons") }]}
        actions={
          options ? (
            <CreateCouponForm options={options} />
          ) : null
        }
      />
      {coupons ? (
        <AdminCouponsTable rows={coupons} />
      ) : (
        <EmptyState
          icon={Ticket}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
