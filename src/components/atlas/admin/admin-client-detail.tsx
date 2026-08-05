import { MoneyValue } from "@/components/atlas/money-value";
import { RequestNumber } from "@/components/atlas/request-number";
import { StateBadge } from "@/components/atlas/state-badge";
import type { AdminClientDetail } from "@/server/admin/queries";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";

type Props = { data: AdminClientDetail };

export async function AdminClientDetailPanel({ data }: Props) {
  const t = await getTranslations("adminOps.clientDetail");
  const locale = await getLocale();
  const owner = data.users.find((u) => u.roles.includes("CLIENT_OWNER"));
  const people = data.users.filter((u) => u.id !== owner?.id);

  return (
    <div className="space-y-6">
      <section className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-xs text-ink-500">{t("email")}</p>
          <p className="text-sm text-ink-900" dir="ltr">
            {data.email}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-500">{t("phone")}</p>
          <p className="text-sm text-ink-900" dir="ltr">
            {data.phone ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-500">{t("cr")}</p>
          <p className="font-data text-sm text-ink-900" dir="ltr">
            {data.crNumber ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs text-ink-500">{t("vat")}</p>
          <p className="font-data text-sm text-ink-900" dir="ltr">
            {data.vatNumber ?? "—"}
          </p>
        </div>
        {data.canViewFinance ? (
          <>
            <div>
              <p className="text-xs text-ink-500">{t("balance")}</p>
              <MoneyValue amount={data.balance} />
            </div>
            <div>
              <p className="text-xs text-ink-500">{t("creditLimit")}</p>
              <MoneyValue amount={data.creditLimit} />
            </div>
          </>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("requests")}</h2>
        {data.recentRequests.length === 0 ? (
          <p className="text-sm text-ink-500">—</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <tbody>
                {data.recentRequests.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      <Link href={`/${locale}/admin/requests/${r.id}`}>
                        <RequestNumber value={r.requestNo} />
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-800">
                      {locale === "ar" ? r.productNameAr : r.productNameEn}
                    </td>
                    <td className="px-3 py-2">
                      <StateBadge state={r.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.canViewFinance ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-ink-900">{t("finance")}</h2>
          {data.recentLedger.length === 0 ? (
            <p className="text-sm text-ink-500">—</p>
          ) : (
            <ul className="space-y-2">
              {data.recentLedger.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-alt px-3 py-2 text-sm"
                >
                  <span className="text-ink-800">
                    {locale === "ar" ? entry.descriptionAr : entry.descriptionEn}
                  </span>
                  <span className="font-data" dir="ltr">
                    <MoneyValue amount={entry.debit > 0 ? entry.debit : -entry.credit} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("owner")}</h2>
        {owner ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-alt p-3 text-sm">
            <div>
              <p className="font-medium text-ink-900">
                {locale === "ar" ? owner.fullNameAr : owner.fullNameEn}
              </p>
              <p className="text-xs text-ink-500" dir="ltr">
                {owner.email}
              </p>
            </div>
            <span className="text-xs text-ink-500">{owner.roles.join(", ")}</span>
          </div>
        ) : (
          <p className="text-sm text-ink-500">{t("noOwner")}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("users")}</h2>
        {people.length === 0 ? (
          <p className="text-sm text-ink-500">—</p>
        ) : (
          <ul className="space-y-2">
            {people.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface p-3 text-sm"
              >
                <div>
                  <p className="font-medium text-ink-900">
                    {locale === "ar" ? u.fullNameAr : u.fullNameEn}
                  </p>
                  <p className="text-xs text-ink-500" dir="ltr">
                    {u.email}
                  </p>
                </div>
                <span className="text-xs text-ink-500">{u.roles.join(", ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
