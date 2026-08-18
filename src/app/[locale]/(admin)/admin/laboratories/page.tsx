import {
  AdminLaboratoriesTable,
  AdminTestTypesTable,
} from "@/components/atlas/admin/admin-laboratories-table";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { listLaboratories, listTestTypes } from "@/server/admin/queries";
import { FlaskConical } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminLaboratoriesPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "laboratories:manage", locale);

  const t = await getTranslations("adminOps.laboratories");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const [laboratories, testTypes] = await Promise.all([
    listLaboratories(),
    listTestTypes(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={tNav("laboratories")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("laboratories") }]}
      />
      {laboratories && testTypes ? (
        <>
          <AdminLaboratoriesTable rows={laboratories} />
          <AdminTestTypesTable rows={testTypes} />
        </>
      ) : (
        <EmptyState
          icon={FlaskConical}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
