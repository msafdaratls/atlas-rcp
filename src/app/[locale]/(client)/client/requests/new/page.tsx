import { NewRequestWizard } from "@/components/atlas/requests/new-request-wizard";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requireClientPagePermission } from "@/lib/page-auth";
import {
  getCatalogueForNewRequest,
  getDraftRequest,
  getOpenDraftRequestId,
} from "@/server/requests/queries";
import { listOrganisationCredentials } from "@/server/company/credentials";
import { FilePlus2 } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ resume?: string; main?: string }>;
};

export default async function NewRequestPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requireClientPagePermission(session, "requests:create", locale);

  const sp = await searchParams;
  const t = await getTranslations("newRequest");
  const tNav = await getTranslations("nav.client");
  const catalogue = await getCatalogueForNewRequest();
  const draftId = sp.resume ?? (await getOpenDraftRequestId());
  const draft = draftId ? await getDraftRequest(draftId) : null;
  const credentials = await listOrganisationCredentials().catch(() => []);

  return (
    <div>
      <PageHeader
        title={tNav("newRequest")}
        description={t("pageDescription")}
        breadcrumbs={[
          { label: tNav("myRequests"), href: `/${locale}/client/requests` },
          { label: tNav("newRequest") },
        ]}
      />
      {catalogue ? (
        <NewRequestWizard
          catalogue={catalogue}
          initialDraft={draft}
          initialMainId={sp.main ?? null}
          credentials={credentials}
        />
      ) : (
        <EmptyState
          icon={FilePlus2}
          title={t("unavailableTitle")}
          description={t("unavailableDescription")}
        />
      )}
    </div>
  );
}
