import { AdminEngagementsTable } from "@/components/atlas/admin/admin-engagements-table";
import { CreateEngagementForm } from "@/components/atlas/admin/create-engagement-form";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { prisma } from "@/lib/db";
import { listClientsForOnBehalf } from "@/server/admin/queries";
import { listEngagements } from "@/server/admin/engagements";
import { Briefcase } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminEngagementsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const t = await getTranslations("adminOps.engagements");
  const tNav = await getTranslations("nav.admin");

  const [engagements, clients, services] = await Promise.all([
    listEngagements(),
    listClientsForOnBehalf(),
    prisma.serviceItem.findMany({
      where: { active: true, subCategory: { code: "ACCOUNT_MANAGEMENT" } },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={tNav("engagements")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("engagements") }]}
        actions={
          clients && services.length > 0 ? (
            <CreateEngagementForm clients={clients} services={services} locale={locale} />
          ) : null
        }
      />
      {engagements ? (
        <AdminEngagementsTable rows={engagements} locale={locale} />
      ) : (
        <EmptyState
          icon={Briefcase}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
        />
      )}
    </div>
  );
}
