import { EvalCatalogView } from "@/components/atlas/admin/eval-catalog/eval-catalog-view";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { checkPermission } from "@/lib/rbac";
import { getEvalCatalogRegulations } from "@/server/admin/queries";
import { ClipboardList, FileSpreadsheet } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ regulation?: string }>;
};

export default async function AdminEvalCatalogPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const { regulation: focusCode } = await searchParams;

  const session = await requireSession();
  // Either eval-catalog permission gets in — Quality manages general/
  // labeling + general standards, Evaluator/CoC manages specific standards.
  if (
    !checkPermission(session, "eval-catalog:manage") &&
    !checkPermission(session, "eval-catalog:specific-standard")
  ) {
    requirePagePermission(session, "eval-catalog:manage", locale);
  }

  const t = await getTranslations("adminOps.evalCatalog");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const regulations = await getEvalCatalogRegulations();

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("evalCatalog"), href: `/${locale}/admin/eval-catalog/import` },
          { label: t("pageTitle") },
        ]}
        actions={
          checkPermission(session, "eval-catalog:manage") ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${locale}/admin/eval-catalog/import`}>
                <FileSpreadsheet className="size-4" />
                {t("importLink")}
              </Link>
            </Button>
          ) : null
        }
      />
      {regulations ? (
        <EvalCatalogView
          regulations={regulations}
          canEditGeneral={checkPermission(session, "eval-catalog:manage")}
          canEditSpecific={checkPermission(session, "eval-catalog:specific-standard")}
          focusCode={focusCode}
        />
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
