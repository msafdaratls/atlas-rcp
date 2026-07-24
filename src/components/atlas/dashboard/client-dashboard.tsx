import { MoneyValue } from "@/components/atlas/money-value";
import { StateBadge } from "@/components/atlas/state-badge";
import { Button } from "@/components/ui/button";
import { FilePlus2, Pill, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ClientDashboardView } from "@/server/dashboard/client-queries";

type Props = { data: ClientDashboardView; locale: string };

export async function ClientDashboard({ data, locale }: Props) {
  const t = await getTranslations("dashboard.client");
  const tReasons = await getTranslations("returnReasons");

  if (data.mode === "finance") {
    return (
      <div className="space-y-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {(
            [
              ["balance", data.stats.balance],
              ["openInvoices", data.stats.openInvoiceCount],
              ["overdue", data.stats.overdueAmount],
            ] as const
          ).map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg border border-line bg-surface p-4 shadow-elevation"
            >
              <p className="text-xs font-semibold text-ink-500">
                {t(`financeStats.${key}`)}
              </p>
              <p
                className="mt-2 font-data text-xl font-semibold text-ink-900"
                dir="ltr"
              >
                {key === "openInvoices" ? value : <MoneyValue amount={value} />}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-900">
              {t("financeInvoicesTitle")}
            </h2>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/${locale}/client/statement`}>
                {t("viewStatement")}
              </Link>
            </Button>
          </div>
          {data.recentInvoices.length === 0 ? (
            <p className="text-sm text-ink-500">{t("financeInvoicesEmpty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.recentInvoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-data text-xs text-ink-500" dir="ltr">
                      {inv.invoiceNo}
                    </p>
                    <p className="text-xs text-ink-500">
                      {t(`invoiceStatus.${inv.status}` as "invoiceStatus.ISSUED")}
                      {inv.dueAt
                        ? ` · ${t("dueAt")} ${inv.dueAt.slice(0, 10)}`
                        : ""}
                    </p>
                  </div>
                  <div className="text-end">
                    <p className="font-data text-sm font-semibold text-ink-900" dir="ltr">
                      <MoneyValue amount={inv.openAmount > 0 ? inv.openAmount : inv.total} />
                    </p>
                    <Button asChild variant="ghost" size="sm" className="h-auto p-0 text-atlas-green-600">
                      <Link
                        href={`/${locale}/client/statement?invoice=${inv.id}`}
                      >
                        {t("openInvoice")}
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.attention.length > 0 ? (
        <section
          className="rounded-lg border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-4"
          aria-label={t("attentionTitle")}
        >
          <h2 className="text-sm font-semibold text-state-warn">
            {t("attentionTitle")}
          </h2>
          <ul className="mt-3 space-y-2">
            {data.attention.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-data text-xs text-ink-500" dir="ltr">
                    {item.requestNo}
                  </p>
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {locale === "ar" ? item.productNameAr : item.productNameEn}
                  </p>
                  <p className="text-xs text-ink-500">
                    {item.reasonCode
                      ? tReasons(item.reasonCode)
                      : t("attentionFallback")}
                    {item.note ? ` — ${item.note}` : ""}
                  </p>
                </div>
                <Button asChild size="sm">
                  <Link href={`/${locale}/client/requests/${item.id}`}>
                    {t("resubmit")}
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(
          [
            ["open", data.stats.openRequests],
            ["inReview", data.stats.inReview],
            ["reports", data.stats.reportsThisYear],
            ["balance", data.stats.balance],
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg border border-line bg-surface p-4 shadow-elevation"
          >
            <p className="text-xs font-semibold text-ink-500">
              {t(`stats.${key}`)}
            </p>
            <p
              className="mt-2 font-data text-xl font-semibold text-ink-900"
              dir="ltr"
            >
              {key === "balance" ? <MoneyValue amount={value} /> : value}
            </p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-900">{t("startTitle")}</h2>
          <Button asChild>
            <Link href={`/${locale}/client/requests/new`}>
              <FilePlus2 className="size-4" />
              {t("startCta")}
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/${locale}/client/requests/new?main=${cat.id}`}
              className="rounded-lg border border-line bg-surface-alt p-4 transition-colors duration-150 ease-out hover:border-atlas-green hover:bg-atlas-green-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-atlas-green-300"
            >
              <div className="mb-2 flex size-9 items-center justify-center rounded-md border border-line bg-surface text-atlas-green">
                {cat.code === "COSMETICS" ? (
                  <Sparkles className="size-4" />
                ) : (
                  <Pill className="size-4" />
                )}
              </div>
              <p className="font-semibold text-ink-900">
                {locale === "ar" ? cat.nameAr : cat.nameEn}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {locale === "ar" ? cat.descAr : cat.descEn}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          {t("activityTitle")}
        </h2>
        {data.recentEvents.length === 0 ? (
          <p className="text-sm text-ink-500">{t("activityEmpty")}</p>
        ) : (
          <ol className="space-y-3">
            {data.recentEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/${locale}/client/requests/${ev.requestId}`}
                      className="font-data text-xs text-atlas-green-600"
                      dir="ltr"
                    >
                      {ev.requestNo}
                    </Link>
                    <StateBadge state={ev.toState} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {locale === "ar" ? ev.actorNameAr : ev.actorNameEn}
                    {ev.note ? ` · ${ev.note}` : ""}
                  </p>
                </div>
                <time
                  className="font-data text-xs text-ink-500"
                  dateTime={ev.createdAt}
                  dir="ltr"
                >
                  {ev.createdAt.slice(0, 16).replace("T", " ")}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
