"use client";

import { MoneyValue } from "@/components/atlas/money-value";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminDashboardView } from "@/server/dashboard/admin-queries";

type Props = { data: AdminDashboardView };

const BAR_FILL = "var(--atlas-green)";
const BAR_RISK = "var(--state-warn)";

export function AdminAnalyticsView({ data }: Props) {
  const t = useTranslations("adminOps.analytics");
  const tQueues = useTranslations("dashboard.admin.queues");
  const tReasons = useTranslations("returnReasons");
  const locale = useLocale();

  const queueChart = data.queues.map((q) => ({
    key: q.key,
    label: tQueues(q.key),
    depth: q.depth,
    atRisk: q.atRisk,
  }));

  const maxDepth = Math.max(1, ...data.queues.map((q) => q.depth));
  const slaAtRiskTotal = data.queues.reduce((sum, q) => sum + q.atRisk, 0);
  const receivedTotal = data.receivedVsClosed.reduce(
    (sum, d) => sum + d.received,
    0,
  );
  const closedTotal = data.receivedVsClosed.reduce(
    (sum, d) => sum + d.closed,
    0,
  );
  const returnTotal = data.topReturnReasons.reduce(
    (sum, r) => sum + r.count,
    0,
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            {t("queueDistribution")}
          </h2>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={queueChart} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={110}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip />
                <Bar dataKey="depth" name={t("depthLabel")} radius={2}>
                  {queueChart.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.atRisk > 0 ? BAR_RISK : BAR_FILL}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            {t("slaSummary")}
          </h2>
          <p className="font-data text-3xl font-semibold text-ink-900" dir="ltr">
            {slaAtRiskTotal}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {slaAtRiskTotal > 0 ? t("slaAtRiskTotal") : t("slaAtRiskNone")}
          </p>
          <ul className="mt-4 space-y-2">
            {data.queues.map((q) => (
              <li key={q.key}>
                <Link
                  href={`/${locale}/admin/requests?queue=${q.key}`}
                  className="flex items-center justify-between gap-2 text-sm text-ink-800 transition-colors duration-150 ease-out hover:text-atlas-green-600"
                >
                  <span>{tQueues(q.key)}</span>
                  <span className="font-data text-ink-500" dir="ltr">
                    {q.atRisk}/{q.depth}
                  </span>
                </Link>
                <div className="mt-1 h-1.5 overflow-hidden rounded-sm bg-surface-alt">
                  <div
                    className="h-full bg-atlas-green transition-[width] duration-150 ease-out"
                    style={{
                      width: `${Math.round((q.depth / maxDepth) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            {t("throughputTitle")}
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-line bg-surface-alt p-3">
              <dt className="text-xs text-ink-500">{t("received")}</dt>
              <dd className="mt-1 font-data text-2xl font-semibold text-ink-900" dir="ltr">
                {receivedTotal}
              </dd>
            </div>
            <div className="rounded-md border border-line bg-surface-alt p-3">
              <dt className="text-xs text-ink-500">{t("closed")}</dt>
              <dd className="mt-1 font-data text-2xl font-semibold text-ink-900" dir="ltr">
                {closedTotal}
              </dd>
            </div>
          </dl>
        </div>

        {data.canSeeFinance ? (
          <div className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              {t("revenueMixTitle", { month: data.revenue.monthLabel })}
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">{t("revenueOriginal")}</dt>
                <dd className="font-data" dir="ltr">
                  <MoneyValue amount={data.revenue.original} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">{t("revenueResubmission")}</dt>
                <dd className="font-data" dir="ltr">
                  <MoneyValue amount={data.revenue.resubmission} />
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold">
                <dt>{t("revenueTotal")}</dt>
                <dd className="font-data" dir="ltr">
                  <MoneyValue
                    amount={data.revenue.original + data.revenue.resubmission}
                  />
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          {t("returnMixTitle")}
        </h2>
        {data.topReturnReasons.length === 0 ? (
          <p className="text-sm text-ink-500">{t("returnMixEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {data.topReturnReasons.map((row) => {
              const pct =
                returnTotal > 0
                  ? Math.round((row.count / returnTotal) * 100)
                  : 0;
              return (
                <li key={row.reason}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="text-ink-800">{tReasons(row.reason)}</span>
                    <span className="font-data text-ink-500" dir="ltr">
                      {row.count} · {pct}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-sm bg-surface-alt">
                    <div
                      className="h-full bg-atlas-green"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
