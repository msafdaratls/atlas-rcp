import { CompanyProfileForm } from "@/components/atlas/company/company-profile-form";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { getCompanyProfilePageData } from "@/server/company/queries";
import { Building2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function CompanyProfilePage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "company:read", locale);

  const t = await getTranslations("company");
  const tNav = await getTranslations("nav.client");
  const result = await getCompanyProfilePageData();

  const emptyTitle =
    result.status === "error" && result.reason === "NOT_CLIENT"
      ? t("wrongPortalTitle")
      : t("unavailableTitle");
  const emptyDescription =
    result.status === "error" && result.reason === "NOT_CLIENT"
      ? t("wrongPortalDescription")
      : result.status === "error" && result.reason === "FORBIDDEN"
        ? t("forbiddenDescription")
        : t("unavailableDescription");

  return (
    <div>
      <PageHeader
        title={tNav("company")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("company") }]}
      />
      {result.status === "ok" ? (
        <CompanyProfileForm initial={result.data} />
      ) : (
        <EmptyState
          icon={Building2}
          title={emptyTitle}
          description={emptyDescription}
        />
      )}
    </div>
  );
}
