import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AdminDocumentsView } from "@/components/atlas/admin/admin-documents-view";
import { PageHeader } from "@/components/atlas/page-header";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import type { DocumentTypeFilter } from "@/server/admin/documents-queries";
import { getDocumentsView } from "@/server/admin/documents-queries";

export const dynamic = "force-dynamic";

const TYPE_FILTERS: DocumentTypeFilter[] = ["ALL", "PDF", "IMAGE", "OTHER"];

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; type?: string; page?: string }>;
};

export default async function AdminDocumentsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "requests:admin", locale);

  const sp = await searchParams;
  const type: DocumentTypeFilter = TYPE_FILTERS.includes(sp.type as DocumentTypeFilter)
    ? (sp.type as DocumentTypeFilter)
    : "ALL";
  const filters = { q: sp.q || undefined, type };

  const data = await getDocumentsView({
    page: sp.page ? Number(sp.page) : 1,
    ...filters,
  });

  const t = await getTranslations("adminOps.documents");
  const tNav = await getTranslations("nav.admin");

  return (
    <div>
      <PageHeader
        title={tNav("documents")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("documents") }]}
      />
      <AdminDocumentsView data={data} locale={locale} filters={filters} />
    </div>
  );
}
