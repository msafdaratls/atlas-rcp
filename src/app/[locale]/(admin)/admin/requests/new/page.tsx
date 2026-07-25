import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { FilePlus2 } from "lucide-react";

import {
  AdminOnBehalfBanner,
  AdminOnBehalfPicker,
} from "@/components/atlas/admin/admin-onbehalf-picker";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { NewRequestWizard } from "@/components/atlas/requests/new-request-wizard";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { ACTING_ORG_COOKIE } from "@/lib/request-context";
import { listClientsForOnBehalf } from "@/server/admin/queries";
import {
  getCatalogueForNewRequest,
  getDraftRequest,
  getOpenDraftRequestId,
} from "@/server/requests/queries";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function AdminNewRequestPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:create-behalf", locale);

  const tNav = await getTranslations("nav.admin");
  const tReq = await getTranslations("adminOps.requests");
  const tNew = await getTranslations("newRequest");

  const breadcrumbs = [
    { label: tNav("requests"), href: `/${locale}/admin/requests` },
    { label: tReq("newRequest") },
  ];

  // Is a client currently pinned for on-behalf creation?
  const store = await cookies();
  const actingOrgId = store.get(ACTING_ORG_COOKIE)?.value ?? null;
  const actingOrg = actingOrgId
    ? await prisma.organisation.findFirst({
        where: { id: actingOrgId, type: "CLIENT", status: "ACTIVE" },
        select: { nameEn: true, nameAr: true },
      })
    : null;

  if (!actingOrg) {
    const clients = (await listClientsForOnBehalf()) ?? [];
    return (
      <div>
        <PageHeader
          title={tReq("onBehalf.title")}
          description={tReq("onBehalf.description")}
          breadcrumbs={breadcrumbs}
        />
        <AdminOnBehalfPicker clients={clients} />
      </div>
    );
  }

  const clientName = locale === "ar" ? actingOrg.nameAr : actingOrg.nameEn;
  const catalogue = await getCatalogueForNewRequest();
  const draftId = await getOpenDraftRequestId();
  const draft = draftId ? await getDraftRequest(draftId) : null;

  return (
    <div>
      <PageHeader
        title={tReq("onBehalf.title")}
        description={tReq("onBehalf.description")}
        breadcrumbs={breadcrumbs}
      />
      <AdminOnBehalfBanner clientName={clientName} />
      {catalogue ? (
        <NewRequestWizard
          catalogue={catalogue}
          initialDraft={draft}
          redirectBasePath="/admin/requests"
          onBehalf
        />
      ) : (
        <EmptyState
          icon={FilePlus2}
          title={tNew("unavailableTitle")}
          description={tNew("unavailableDescription")}
        />
      )}
    </div>
  );
}
