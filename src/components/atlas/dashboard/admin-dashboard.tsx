"use client";

import { MoneyValue } from "@/components/atlas/money-value";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminDashboardView } from "@/server/dashboard/admin-queries";

type Props = { data: AdminDashboardView };

export function AdminDashboard({ data }: Props) {
  const t = useTranslations("dashboard.admin");
  const tReasons = useTranslations("returnReasons");
  const locale = useLocale();

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.queues.map((q) => (
          <Link
            key={q.key}
            href={`/${locale}/admin/requests?queue=${q.key}`}
            className="rounded-lg border border-line bg-surface p-4 shadow-elevation transition-colors duration-150 ease-out hover:border-atlas-green"
          >
            <p className="text-xs font-semibold text-ink-500">
              {t(`queues.${q.key}`)}
            </p>
            <p className="mt-2 font-data text-2xl font-semibold text-ink-900">
              {q.depth}
            </p>
            {q.atRisk > 0 ? (
              <p className="mt-1 font-data text-xs font-semibold text-state-bad">
                {t("atRisk", { count: q.atRisk })}
              </p>
            ) : (
              <p className="mt-1 text-xs text-ink-500">{t("atRiskNone")}</p>
            )}
          </Link>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            {t("chartTitle")}
          </h2>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.receivedVsClosed}>
                <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="received"
                  name={t("received")}
                  fill="var(--atlas-green)"
                  radius={2}
                />
                <Bar
                  dataKey="closed"
                  name={t("closed")}
                  fill="var(--state-info)"
                  radius={2}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            {t("returnReasonsTitle")}
          </h2>
          <p className="mb-3 text-xs text-ink-500">{t("returnReasonsHint")}</p>
          {data.topReturnReasons.length === 0 ? (
            <p className="text-sm text-ink-500">{t("returnReasonsEmpty")}</p>
          ) : (
            <ul className="space-y-2">
              {data.topReturnReasons.map((row) => (
                <li
                  key={row.reason}
                  className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0"
                >
                  <span className="text-sm text-ink-800">
                    {tReasons(row.reason)}
                  </span>
                  <span className="font-data text-sm font-semibold" dir="ltr">
                    {row.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {data.canSeeFinance ? (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              {t("revenueTitle", { month: data.revenue.monthLabel })}
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
                    amount={
                      data.revenue.original + data.revenue.resubmission
                    }
                  />
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              {t("overLimitTitle")}
            </h2>
            {data.overLimit.length === 0 ? (
              <p className="text-sm text-ink-500">{t("overLimitEmpty")}</p>
            ) : (
              <ul className="space-y-2">
                {data.overLimit.map((c) => (
                  <li
                    key={c.organisationId}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0"
                  >
                    <span className="text-sm font-medium text-ink-900">
                      {locale === "ar" ? c.nameAr : c.nameEn}
                    </span>
                    <span
                      className="font-data text-xs text-state-bad"
                      dir="ltr"
                    >
                      <MoneyValue amount={c.balance} /> /{" "}
                      <MoneyValue amount={c.creditLimit} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
