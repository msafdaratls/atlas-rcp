import type { QualityView } from "@/server/admin/queries";
import { getLocale, getTranslations } from "next-intl/server";

type Props = { data: QualityView };

export async function AdminQualityView({ data }: Props) {
  const t = await getTranslations("adminOps.quality");
  const tReasons = await getTranslations("returnReasons");
  const locale = await getLocale();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("returnsTitle")}</h2>
        {data.reasons.length === 0 ? (
          <p className="text-sm text-ink-500">{t("emptyReturns")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-surface-alt">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("columns.reason")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold text-ink-500">
                    {t("columns.count")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.reasons.map((row) => (
                  <tr key={row.reason} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 text-ink-800">{tReasons(row.reason)}</td>
                    <td className="px-3 py-2 text-end font-data font-semibold text-ink-900" dir="ltr">
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("auditTitle")}</h2>
        {data.auditLog.length === 0 ? (
          <p className="text-sm text-ink-500">{t("emptyAudit")}</p>
        ) : (
          <div className="max-h-[28rem] overflow-x-auto overflow-y-auto rounded-lg border border-line">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead className="sticky top-0 bg-surface-alt">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("auditColumns.when")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("auditColumns.actor")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("auditColumns.action")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("auditColumns.entity")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.auditLog.map((entry) => {
                  const actorName =
                    (locale === "ar" ? entry.actorNameAr : entry.actorNameEn) ??
                    entry.actorEmail ??
                    t("systemActor");
                  return (
                    <tr key={entry.id} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2 font-data text-xs text-ink-500" dir="ltr">
                        {entry.createdAt.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="max-w-[10rem] truncate px-3 py-2 text-ink-800">
                        {actorName}
                      </td>
                      <td className="px-3 py-2 font-data text-xs text-ink-800" dir="ltr">
                        {entry.action}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-500">{entry.entityType}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
