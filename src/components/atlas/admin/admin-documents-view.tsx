import { FileImage, FileText, FileType2, Files } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/atlas/empty-state";
import { formatDateTime } from "@/lib/format";
import type { DocumentsView, DocumentTypeFilter } from "@/server/admin/documents-queries";

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function formatBytes(bytes: number, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  }).format(bytes);
}

function FileGlyph({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) {
    return <FileImage className="size-4 text-atlas-green" aria-hidden />;
  }
  if (mimeType === "application/pdf") {
    return <FileText className="size-4 text-state-bad" aria-hidden />;
  }
  return <FileType2 className="size-4 text-ink-500" aria-hidden />;
}

const TYPE_OPTIONS: DocumentTypeFilter[] = ["ALL", "PDF", "IMAGE", "OTHER"];

/**
 * Read-only, system-wide list of every uploaded document (labels, COAs,
 * certificates, evaluation-activity and external-deliverable reports) across
 * all requests. Filters submit via a native GET form so state is
 * shareable/bookmarkable and needs no client JS — same pattern as the audit
 * log view.
 */
export async function AdminDocumentsView({
  data,
  locale,
  filters,
}: {
  data: DocumentsView;
  locale: string;
  filters: { q?: string; type?: DocumentTypeFilter };
}) {
  const t = await getTranslations("adminOps.documents");
  const tCommon = await getTranslations("common");
  const nameKey: "organisationNameAr" | "organisationNameEn" =
    locale === "ar" ? "organisationNameAr" : "organisationNameEn";
  const productKey: "productNameAr" | "productNameEn" =
    locale === "ar" ? "productNameAr" : "productNameEn";
  const uploaderKey: "uploadedByNameAr" | "uploadedByNameEn" =
    locale === "ar" ? "uploadedByNameAr" : "uploadedByNameEn";

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.type && filters.type !== "ALL") params.set("type", filters.type);
    params.set("page", String(page));
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
          {tCommon("search")}
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="h-9 w-64 rounded-lg border border-line bg-surface px-3 text-sm text-ink-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
          {t("filterType")}
          <select
            name="type"
            defaultValue={filters.type ?? "ALL"}
            className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink-800"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {t(`type${opt}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-lg bg-[var(--atlas-green)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--atlas-green-600)]"
        >
          {t("apply")}
        </button>
        {filters.q || (filters.type && filters.type !== "ALL") ? (
          <a
            href="?"
            className="h-9 rounded-lg border border-line px-4 text-sm font-medium text-ink-800 transition-colors hover:bg-surface-alt flex items-center"
          >
            {tCommon("clearFilters")}
          </a>
        ) : null}
      </form>

      {data.rows.length === 0 ? (
        <EmptyState icon={Files} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-surface-alt">
              <tr className="border-b border-line text-start text-xs font-semibold text-ink-500">
                <th className="px-3 py-2.5 text-start">{t("colFile")}</th>
                <th className="px-3 py-2.5 text-start">{t("colRequest")}</th>
                <th className="px-3 py-2.5 text-start">{t("colClient")}</th>
                <th className="px-3 py-2.5 text-start">{t("colUploadedBy")}</th>
                <th className="px-3 py-2.5 text-start">{t("colUploadedAt")}</th>
                <th className="px-3 py-2.5 text-start">{t("colSize")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <a
                      href={storageUrl(row.storageKey)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-ink-900 hover:text-atlas-green"
                    >
                      <FileGlyph mimeType={row.mimeType} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.label}</span>
                        <span className="block truncate text-xs text-ink-500" dir="ltr">
                          {row.fileName}
                          {row.version > 1 ? ` · v${row.version}` : ""}
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <a
                      href={`/${locale}/admin/requests/${row.requestId}`}
                      className="font-mono text-xs text-atlas-green hover:underline"
                    >
                      {row.requestNo}
                    </a>
                    {row[productKey] ? (
                      <span className="ms-1 truncate text-xs text-ink-500">
                        · {row[productKey]}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">{row[nameKey]}</td>
                  <td className="px-3 py-2.5 text-ink-800">{row[uploaderKey]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-500">
                    {formatDateTime(row.uploadedAt, locale)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-ink-500">
                    {formatBytes(row.sizeBytes, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-ink-500">
        <span>{t("total", { count: data.total })}</span>
        <div className="flex items-center gap-2">
          {data.page > 1 ? (
            <a
              href={buildPageHref(data.page - 1)}
              className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-alt"
            >
              {t("prev")}
            </a>
          ) : null}
          <span className="font-mono text-xs">
            {data.page} / {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <a
              href={buildPageHref(data.page + 1)}
              className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface-alt"
            >
              {t("next")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
