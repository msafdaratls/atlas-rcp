import { getTranslations } from "next-intl/server";

import type { AuditLogView } from "@/server/admin/audit-queries";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/atlas/empty-state";
import { ScrollText } from "lucide-react";

/**
 * Read-only compliance audit-log table. Filters submit via a native GET form
 * (URL-driven), so state is shareable/bookmarkable and needs no client JS.
 */
export async function AdminAuditView({
  data,
  locale,
  filters,
}: {
  data: AuditLogView;
  locale: string;
  filters: { action?: string; entityType?: string };
}) {
  const t = await getTranslations("adminOps.audit");

  const buildPageHref = (page: number) => {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.entityType) params.set("entityType", filters.entityType);
    params.set("page", String(page));
    return `?${params.toString()}`;
  };

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
          {t("filterAction")}
          <select
            name="action"
            defaultValue={filters.action ?? ""}
            className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink-800"
          >
            <option value="">{t("allActions")}</option>
            {data.actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-500">
          {t("filterEntity")}
          <input
            name="entityType"
            defaultValue={filters.entityType ?? ""}
            placeholder="Request, Invoice, User…"
            className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink-800"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-lg bg-[var(--atlas-green)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--atlas-green-600)]"
        >
          {t("apply")}
        </button>
      </form>

      {data.rows.length === 0 ? (
        <EmptyState icon={ScrollText} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-alt">
              <tr className="border-b border-line text-start text-xs font-semibold text-ink-500">
                <th className="px-3 py-2.5 text-start">{t("colWhen")}</th>
                <th className="px-3 py-2.5 text-start">{t("colActor")}</th>
                <th className="px-3 py-2.5 text-start">{t("colAction")}</th>
                <th className="px-3 py-2.5 text-start">{t("colEntity")}</th>
                <th className="px-3 py-2.5 text-start">{t("colOrg")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-500">
                    {formatDateTime(row.createdAt, locale)}
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {row.actorName ?? "—"}
                    {row.actorRole ? (
                      <span className="ms-1 text-xs text-ink-500">
                        ({row.actorRole})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-ink-900">
                    {row.action}
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {row.entityType}
                    <span className="ms-1 font-mono text-xs text-ink-500">
                      {row.entityId.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {row.organisationName ?? "—"}
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
