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
import { listOrganisationCredentials } from "@/server/company/credentials";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ engagement?: string; confirmed?: string }>;
};

export default async function AdminNewRequestPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const sp = await searchParams;

  const session = await requireSession();
  requirePagePermission(session, "requests:create-behalf", locale);

  const tNav = await getTranslations("nav.admin");
  const tReq = await getTranslations("adminOps.requests");
  const tNew = await getTranslations("newRequest");

  const breadcrumbs = [
    { label: tNav("requests"), href: `/${locale}/admin/requests` },
    { label: tReq("newRequest") },
  ];

  // Is a client currently pinned for on-behalf creation? Only trust it to
  // skip straight into the wizard when we arrived via an explicit deep link
  // (e.g. "new request under this engagement", which pins the org itself
  // right before redirecting here) or the on-behalf picker below just
  // confirmed it. Landing on the plain /admin/requests/new entry point
  // always re-confirms the client, even if a pin from an earlier, unrelated
  // visit is still sitting in the cookie — otherwise a stale pin can
  // silently attach a new request (and its pre-filled draft) to the wrong
  // client's organisation.
  const store = await cookies();
  const actingOrgId = store.get(ACTING_ORG_COOKIE)?.value ?? null;
  const trustPin = Boolean(sp.engagement) || sp.confirmed === "1";
  const actingOrg =
    actingOrgId && trustPin
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
        <AdminOnBehalfPicker clients={clients} defaultOrgId={actingOrgId ?? ""} />
      </div>
    );
  }

  const clientName = locale === "ar" ? actingOrg.nameAr : actingOrg.nameEn;
  const catalogue = await getCatalogueForNewRequest();
  const draftId = await getOpenDraftRequestId();
  const draft = draftId ? await getDraftRequest(draftId) : null;
  const credentials = await listOrganisationCredentials().catch(() => []);

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
          credentials={credentials}
          engagementId={sp.engagement ?? null}
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
