import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminSystemHealthView } from "@/components/atlas/admin/admin-system-health-view";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getSystemHealthView } from "@/server/admin/system-health-queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminSystemHealthPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "system:health", locale);

  const data = await getSystemHealthView();
  const t = await getTranslations("adminOps.systemHealth");
  const tNav = await getTranslations("nav.admin");

  return (
    <div>
      <PageHeader
        title={tNav("systemHealth")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("systemHealth") }]}
      />
      <AdminSystemHealthView data={data} />
    </div>
  );
}
