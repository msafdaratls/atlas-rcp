import { AdminCatalogueTable } from "@/components/atlas/admin/admin-catalogue-table";
import { CreateServiceWizard } from "@/components/atlas/admin/create-service-wizard";
import { ManageCategoriesDialog } from "@/components/atlas/admin/manage-categories-dialog";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import {
  listActiveEvaluators,
  listAdminCatalogue,
  listAdminCategoryTree,
} from "@/server/admin/queries";
import { Package } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminCataloguePage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "catalogue:manage", locale);

  const t = await getTranslations("adminOps.catalogue");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const [items, categoryTree, evaluators] = await Promise.all([
    listAdminCatalogue(),
    listAdminCategoryTree(),
    listActiveEvaluators(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={tNav("catalogue")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("catalogue") }]}
        actions={
          categoryTree ? (
            <div className="flex flex-wrap items-center gap-2">
              <ManageCategoriesDialog categoryTree={categoryTree} />
              <CreateServiceWizard categoryTree={categoryTree} />
            </div>
          ) : null
        }
      />
      {items ? (
        <AdminCatalogueTable
          rows={items}
          categoryTree={categoryTree ?? []}
          evaluators={evaluators ?? []}
        />
      ) : (
        <EmptyState
          icon={Package}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
