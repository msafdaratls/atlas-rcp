"use client";

import { Download } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { recordClientPayment } from "@/server/finance/actions";
import type { ClientStatementView } from "@/server/finance/queries";

type Props = { data: ClientStatementView };

export function ClientStatementPanel({ data }: Props) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const highlightInvoiceId = searchParams.get("invoice");
  const highlightPaymentId = searchParams.get("payment");
  const highlightRef = useRef<HTMLTableRowElement | HTMLLIElement | null>(
    null,
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [method, setMethod] = useState<
    "BANK_TRANSFER" | "CARD" | "CASH" | "CREDIT_NOTE"
  >("BANK_TRANSFER");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!highlightInvoiceId && !highlightPaymentId) return;
    const timer = setTimeout(() => {
      highlightRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
    return () => clearTimeout(timer);
  }, [highlightInvoiceId, highlightPaymentId]);

  const filteredLedger = useMemo(() => {
    return data.ledger.filter((row) => {
      const d = new Date(row.entryDate).getTime();
      if (from && d < new Date(from).getTime()) return false;
      if (to && d > new Date(to).getTime() + 86400000) return false;
      return true;
    });
  }, [data.ledger, from, to]);

  const owes = data.balance > 0;
  const credit = data.balance < 0;

  function onRecordPayment(formData: FormData) {
    startTransition(async () => {
      const result = await recordClientPayment(formData);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      toast.success(t("payment.recorded"));
    });
  }

  const pdfHref = `/api/finance/statement-pdf?locale=${locale}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-lg border border-line bg-surface p-4 shadow-elevation">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t("balance.title")}
          </p>
          <p
            className={cn(
              "mt-2 font-data text-2xl font-semibold",
              owes && "text-state-bad",
              credit && "text-state-ok",
            )}
          >
            <MoneyValue amount={Math.abs(data.balance)} />
          </p>
          <p className="mt-1 text-sm text-ink-800">
            {owes
              ? t("balance.youOwe")
              : credit
                ? t("balance.inCredit")
                : t("balance.settled")}
          </p>
          {data.creditLimit > 0 ? (
            <div className="mt-4 space-y-1">
              <div className="flex justify-between text-xs text-ink-500">
                <span>{t("balance.creditLimit")}</span>
                <span className="font-data" dir="ltr">
                  {data.creditUsedPct ?? 0}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className={cn(
                    "h-full bg-atlas-green transition-[width] duration-150 ease-out",
                    (data.creditUsedPct ?? 0) >= 90 && "bg-state-bad",
                  )}
                  style={{ width: `${data.creditUsedPct ?? 0}%` }}
                />
              </div>
              <p className="font-data text-xs text-ink-500" dir="ltr">
                <MoneyValue amount={data.creditLimit} />
              </p>
            </div>
          ) : null}
        </section>

        <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ["current", data.aging.current],
              ["d1_30", data.aging.d1_30],
              ["d31_60", data.aging.d31_60],
              ["d61_90", data.aging.d61_90],
              ["d90_plus", data.aging.d90_plus],
            ] as const
          ).map(([key, value]) => (
            <div
              key={key}
              className="rounded-lg border border-line bg-surface p-3"
            >
              <p className="text-[11px] font-semibold text-ink-500">
                {t(`aging.${key}`)}
              </p>
              <p className="mt-1 font-data text-sm font-semibold" dir="ltr">
                <MoneyValue amount={value} />
              </p>
            </div>
          ))}
        </section>
      </div>

      <Tabs defaultValue={highlightInvoiceId ? "invoices" : "ledger"}>
        <TabsList>
          <TabsTrigger value="ledger">{t("tabs.ledger")}</TabsTrigger>
          <TabsTrigger value="invoices">{t("tabs.invoices")}</TabsTrigger>
          <TabsTrigger value="payment">{t("tabs.payment")}</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="from">{t("filters.from")}</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="to">{t("filters.to")}</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <Button asChild variant="outline">
              <a href={pdfHref}>
                <Download className="size-4" />
                {t("downloadStatement")}
              </a>
            </Button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-alt text-xs text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-start">{t("ledger.date")}</th>
                  <th className="px-3 py-2 text-start">{t("ledger.description")}</th>
                  <th className="px-3 py-2 text-start">{t("ledger.reference")}</th>
                  <th className="px-3 py-2 text-end">{t("ledger.debit")}</th>
                  <th className="px-3 py-2 text-end">{t("ledger.credit")}</th>
                  <th className="px-3 py-2 text-end">{t("ledger.balance")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredLedger.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-8 text-center text-ink-500"
                    >
                      {t("ledger.empty")}
                    </td>
                  </tr>
                ) : (
                  filteredLedger.map((row) => {
                    const isHighlighted =
                      row.referenceType === "Payment" &&
                      row.referenceId === highlightPaymentId;
                    return (
                    <tr
                      key={row.id}
                      ref={(el) => {
                        if (isHighlighted && el) highlightRef.current = el;
                      }}
                      className={cn(
                        "border-t border-line",
                        isHighlighted &&
                          "bg-atlas-green-tint ring-1 ring-inset ring-atlas-green",
                      )}
                    >
                      <td className="px-3 py-2 font-data text-xs" dir="ltr">
                        {row.entryDate.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        {locale === "ar"
                          ? row.descriptionAr
                          : row.descriptionEn}
                      </td>
                      <td className="px-3 py-2 font-data text-xs">
                        {row.linkHref ? (
                          <Link
                            href={`/${locale}${row.linkHref}`}
                            className="text-atlas-green-600 underline-offset-2 hover:underline"
                          >
                            {row.referenceType}
                          </Link>
                        ) : (
                          row.referenceType
                        )}
                      </td>
                      <td className="px-3 py-2 text-end font-data" dir="ltr">
                        {row.debit ? <MoneyValue amount={row.debit} /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-end font-data" dir="ltr">
                        {row.credit ? <MoneyValue amount={row.credit} /> : "—"}
                      </td>
                      <td className="px-3 py-2 text-end font-data" dir="ltr">
                        <MoneyValue amount={row.runningBalance} />
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="invoices">
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {data.invoices.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-ink-500">
                {t("invoices.empty")}
              </li>
            ) : (
              data.invoices.map((inv) => (
                <li
                  key={inv.id}
                  ref={(el) => {
                    if (inv.id === highlightInvoiceId && el)
                      highlightRef.current = el;
                  }}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 px-4 py-3",
                    inv.id === highlightInvoiceId &&
                      "bg-atlas-green-tint ring-1 ring-inset ring-atlas-green",
                  )}
                >
                  <div>
                    <p className="font-data text-sm font-semibold" dir="ltr">
                      {inv.invoiceNo}
                    </p>
                    <p className="text-xs text-ink-500">
                      <span className="rounded-full border border-line px-2 py-0.5">
                        {t(`invoiceStatus.${inv.status}` as never)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <MoneyValue amount={inv.total} />
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={`/api/finance/invoices/${inv.id}/pdf?locale=${locale}`}
                      >
                        <Download className="size-4" />
                        {t("invoices.download")}
                      </a>
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </TabsContent>

        <TabsContent value="payment">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onRecordPayment(new FormData(e.currentTarget));
            }}
            className="max-w-lg space-y-4 rounded-lg border border-line bg-surface p-4"
          >
            <div>
              <Label htmlFor="amount">{t("payment.amount")}</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                className="font-data"
                dir="ltr"
              />
            </div>
            <div>
              <Label>{t("payment.method")}</Label>
              <Select
                value={method}
                onValueChange={(v) =>
                  setMethod(v as typeof method)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BANK_TRANSFER">
                    {t("payment.methods.BANK_TRANSFER")}
                  </SelectItem>
                  <SelectItem value="CARD">{t("payment.methods.CARD")}</SelectItem>
                  <SelectItem value="CASH">{t("payment.methods.CASH")}</SelectItem>
                  <SelectItem value="CREDIT_NOTE">
                    {t("payment.methods.CREDIT_NOTE")}
                  </SelectItem>
                </SelectContent>
              </Select>
              <input type="hidden" name="method" value={method} />
            </div>
            <div>
              <Label htmlFor="reference">{t("payment.reference")}</Label>
              <Input id="reference" name="reference" maxLength={120} />
            </div>
            <div>
              <Label htmlFor="proof">{t("payment.proof")}</Label>
              <Input
                id="proof"
                name="proof"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {t("payment.submit")}
            </Button>
            <p className="text-xs text-ink-500">{t("payment.hint")}</p>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
