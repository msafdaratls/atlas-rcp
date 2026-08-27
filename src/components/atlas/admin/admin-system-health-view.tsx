import { formatStamp } from "@/lib/format";
import { getTranslations } from "next-intl/server";
import type { SystemHealthView } from "@/server/admin/system-health-queries";

type Props = { data: SystemHealthView };

function StatCard({ label, value, warn }: { label: string; value: number; warn: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="text-xs font-semibold text-ink-500">{label}</p>
      <p
        className={`mt-1 font-data text-2xl font-semibold ${warn ? "text-state-bad" : "text-ink-900"}`}
        dir="ltr"
      >
        {value}
      </p>
    </div>
  );
}

function formatWhen(iso: string) {
  return formatStamp(iso);
}

export async function AdminSystemHealthView({ data }: Props) {
  const t = await getTranslations("adminOps.systemHealth");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("outboxFailedStat")}
          value={data.outboxFailedCount}
          warn={data.outboxFailedCount > 0}
        />
        <StatCard
          label={t("outboxPendingStat")}
          value={data.outboxPendingCount}
          warn={false}
        />
        <StatCard
          label={t("extractionFailedStat")}
          value={data.extractionFailedCount}
          warn={data.extractionFailedCount > 0}
        />
      </div>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("outboxTitle")}</h2>
        {data.outboxFailed.length === 0 ? (
          <p className="text-sm text-ink-500">{t("outboxEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead className="bg-surface-alt">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("outboxColEvent")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("outboxColChannel")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("outboxColRecipient")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold text-ink-500">
                    {t("outboxColAttempts")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("outboxColError")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("outboxColWhen")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.outboxFailed.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-data text-xs text-ink-800" dir="ltr">
                      {row.eventType}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500">{row.channel}</td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-ink-800">
                      {row.recipient}
                    </td>
                    <td className="px-3 py-2 text-end font-data text-ink-900" dir="ltr">
                      {row.attempts}
                    </td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-xs text-state-bad">
                      {row.lastError ?? t("noError")}
                    </td>
                    <td className="px-3 py-2 font-data text-xs text-ink-500" dir="ltr">
                      {formatWhen(row.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("extractionTitle")}</h2>
        {data.extractionFailed.length === 0 ? (
          <p className="text-sm text-ink-500">{t("extractionEmpty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <thead className="bg-surface-alt">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("extractionColRequest")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("extractionColClient")}
                  </th>
                  <th className="px-3 py-2 text-end text-xs font-semibold text-ink-500">
                    {t("extractionColAttempts")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("extractionColError")}
                  </th>
                  <th className="px-3 py-2 text-start text-xs font-semibold text-ink-500">
                    {t("extractionColWhen")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.extractionFailed.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2 font-data text-xs text-ink-800" dir="ltr">
                      {row.requestNo ?? row.assessmentId}
                    </td>
                    <td className="max-w-[12rem] truncate px-3 py-2 text-ink-800">
                      {row.organisationName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-end font-data text-ink-900" dir="ltr">
                      {row.attempts}
                    </td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-xs text-state-bad">
                      {row.lastError ?? t("noError")}
                    </td>
                    <td className="px-3 py-2 font-data text-xs text-ink-500" dir="ltr">
                      {formatWhen(row.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
