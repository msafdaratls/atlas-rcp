import { RegulationImportPanel } from "@/components/atlas/admin/eval-catalog/regulation-import-panel";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { getRegulationImportPageData } from "@/server/admin/queries";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminEvalCatalogImportPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  // Bulk catalog replacement is a Quality function — deliberately narrower
  // than the eval-catalog page itself, which evaluators can also open.
  requirePagePermission(session, "eval-catalog:manage", locale);

  const t = await getTranslations("adminOps.evalCatalog.import");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const data = await getRegulationImportPageData();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("evalCatalog"), href: `/${locale}/admin/eval-catalog` },
          { label: t("pageTitle") },
        ]}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/${locale}/admin/eval-catalog`}>
              {/* The glyph carries the direction, so it mirrors in RTL rather
                  than being baked into the translated string as an arrow. */}
              <ArrowLeft className="size-4 rtl:rotate-180" />
              {t("backToCatalog")}
            </Link>
          </Button>
        }
      />
      {data ? (
        <RegulationImportPanel regulations={data.regulations} history={data.history} />
      ) : (
        <EmptyState
          icon={FileSpreadsheet}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
