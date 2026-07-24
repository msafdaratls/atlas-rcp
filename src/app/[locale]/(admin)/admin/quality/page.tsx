import { AdminQualityView } from "@/components/atlas/admin/admin-quality-view";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getQualityView } from "@/server/admin/queries";
import { ShieldCheck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminQualityPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "quality:read", locale);

  const t = await getTranslations("adminOps.quality");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const data = await getQualityView();

  return (
    <div>
      <PageHeader
        title={tNav("quality")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("quality") }]}
      />
      {data ? (
        <AdminQualityView data={data} />
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
