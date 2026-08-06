import { CompanyProfileForm } from "@/components/atlas/company/company-profile-form";
import { PlatformCredentialsPanel } from "@/components/atlas/company/platform-credentials-panel";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import { checkPermission } from "@/lib/rbac";
import { getCompanyProfilePageData } from "@/server/company/queries";
import { listOrganisationCredentials } from "@/server/company/credentials";
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
  const credentials =
    result.status === "ok" ? await listOrganisationCredentials().catch(() => []) : [];

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
        <div className="space-y-6">
          <CompanyProfileForm initial={result.data} />
          <PlatformCredentialsPanel
            initial={credentials}
            canManage={checkPermission(session, "credentials:manage")}
          />
        </div>
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
