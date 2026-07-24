"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  confirmPayment,
  postManualLedgerEntry,
  rejectPayment,
  updateClientCreditLimit,
} from "@/server/finance/actions";
import type { AdminFinanceView } from "@/server/finance/queries";

type Props = { data: AdminFinanceView };

export function AdminFinancePanel({ data }: Props) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [sort, setSort] = useState<"balance" | "overdue">("overdue");
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {},
  );

  const balances = useMemo(() => {
    const rows = [...data.clientBalances];
    rows.sort((a, b) =>
      sort === "balance"
        ? b.balance - a.balance
        : b.daysOverdue - a.daysOverdue,
    );
    return rows;
  }, [data.clientBalances, sort]);

  return (
    <Tabs defaultValue="queue">
      <TabsList>
        <TabsTrigger value="queue">{t("admin.tabs.queue")}</TabsTrigger>
        <TabsTrigger value="balances">{t("admin.tabs.balances")}</TabsTrigger>
        <TabsTrigger value="adjust">{t("admin.tabs.adjust")}</TabsTrigger>
      </TabsList>

      <TabsContent value="queue" className="space-y-3">
        {data.pendingPayments.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface-alt px-4 py-8 text-center text-sm text-ink-500">
            {t("admin.queueEmpty")}
          </p>
        ) : (
          data.pendingPayments.map((p) => (
            <article
              key={p.id}
              className="space-y-3 rounded-lg border border-line bg-surface p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink-900">
                    {locale === "ar"
                      ? p.organisationNameAr
                      : p.organisationNameEn}
                  </p>
                  <p className="font-data text-sm" dir="ltr">
                    <MoneyValue amount={p.amount} /> · {p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </p>
                  <p className="text-xs text-ink-500" dir="ltr">
                    {p.receivedAt.slice(0, 10)}
                  </p>
                </div>
                {p.proofUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={p.proofUrl} target="_blank" rel="noreferrer">
                      {t("admin.viewProof")}
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await confirmPayment({ paymentId: p.id });
                      if (!result.ok) {
                        toast.error(t(`errors.${result.error}` as never));
                        return;
                      }
                      toast.success(t("admin.confirmed"));
                    })
                  }
                >
                  {t("admin.confirm")}
                </Button>
                <Input
                  placeholder={t("admin.rejectReason")}
                  value={rejectReasons[p.id] ?? ""}
                  onChange={(e) =>
                    setRejectReasons((prev) => ({
                      ...prev,
                      [p.id]: e.target.value,
                    }))
                  }
                  className="max-w-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const reason = rejectReasons[p.id]?.trim() ?? "";
                      if (reason.length < 3) {
                        toast.error(t("errors.VALIDATION"));
                        return;
                      }
                      const result = await rejectPayment({
                        paymentId: p.id,
                        reason,
                      });
                      if (!result.ok) {
                        toast.error(t(`errors.${result.error}` as never));
                        return;
                      }
                      toast.success(t("admin.rejected"));
                    })
                  }
                >
                  {t("admin.reject")}
                </Button>
              </div>
              <p className="text-xs text-ink-500">{t("admin.fifoHint")}</p>
            </article>
          ))
        )}
      </TabsContent>

      <TabsContent value="balances" className="space-y-3">
        <div className="flex items-center gap-2">
          <Label>{t("admin.sortBy")}</Label>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as "balance" | "overdue")}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overdue">{t("admin.sortOverdue")}</SelectItem>
              <SelectItem value="balance">{t("admin.sortBalance")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="bg-surface-alt text-xs text-ink-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("admin.client")}</th>
                <th className="px-3 py-2 text-end">{t("admin.balance")}</th>
                <th className="px-3 py-2 text-end">{t("admin.daysOverdue")}</th>
                <th className="px-3 py-2 text-start">{t("admin.creditLimit")}</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.organisationId} className="border-t border-line">
                  <td className="px-3 py-2">
                    {locale === "ar" ? row.nameAr : row.nameEn}
                  </td>
                  <td className="px-3 py-2 text-end font-data" dir="ltr">
                    <MoneyValue amount={row.balance} />
                  </td>
                  <td className="px-3 py-2 text-end font-data" dir="ltr">
                    {row.daysOverdue}
                  </td>
                  <td className="px-3 py-2">
                    <CreditLimitEditor
                      organisationId={row.organisationId}
                      creditLimit={row.creditLimit}
                      autoHold={row.autoHoldWhenOverLimit}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="adjust">
        <ManualAdjustmentForm clients={data.clientBalances} />
      </TabsContent>
    </Tabs>
  );
}

function CreditLimitEditor({
  organisationId,
  creditLimit,
  autoHold,
}: {
  organisationId: string;
  creditLimit: number;
  autoHold: boolean;
}) {
  const t = useTranslations("finance");
  const [limit, setLimit] = useState(String(creditLimit));
  const [hold, setHold] = useState(autoHold);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-28 font-data"
        dir="ltr"
        value={limit}
        onChange={(e) => setLimit(e.target.value)}
      />
      <label className="flex items-center gap-1.5 text-xs text-ink-800">
        <Checkbox
          checked={hold}
          onCheckedChange={(v) => setHold(v === true)}
        />
        {t("admin.autoHold")}
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await updateClientCreditLimit({
              organisationId,
              creditLimit: Number(limit),
              autoHoldWhenOverLimit: hold,
            });
            if (!result.ok) {
              toast.error(t(`errors.${result.error}` as never));
              return;
            }
            toast.success(t("admin.limitSaved"));
          })
        }
      >
        {t("admin.saveLimit")}
      </Button>
    </div>
  );
}

function ManualAdjustmentForm({
  clients,
}: {
  clients: AdminFinanceView["clientBalances"];
}) {
  const t = useTranslations("finance");
  const locale = useLocale();
  const [orgId, setOrgId] = useState(clients[0]?.organisationId ?? "");
  const [type, setType] = useState<
    "ADJUSTMENT" | "CREDIT_NOTE" | "REFUND" | "WRITE_OFF"
  >("CREDIT_NOTE");
  const [side, setSide] = useState<"debit" | "credit">("credit");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="max-w-lg space-y-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const result = await postManualLedgerEntry({
            organisationId: orgId,
            type,
            amount: Number(fd.get("amount")),
            side,
            reasonEn: String(fd.get("reasonEn") ?? ""),
            reasonAr: String(fd.get("reasonAr") ?? ""),
          });
          if (!result.ok) {
            toast.error(t(`errors.${result.error}` as never));
            return;
          }
          toast.success(t("admin.adjustmentPosted"));
          e.currentTarget.reset();
        });
      }}
    >
      <div>
        <Label>{t("admin.client")}</Label>
        <Select value={orgId} onValueChange={setOrgId}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.organisationId} value={c.organisationId}>
                {locale === "ar" ? c.nameAr : c.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t("admin.entryType")}</Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as typeof type)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CREDIT_NOTE">
              {t("admin.entryTypes.CREDIT_NOTE")}
            </SelectItem>
            <SelectItem value="ADJUSTMENT">
              {t("admin.entryTypes.ADJUSTMENT")}
            </SelectItem>
            <SelectItem value="REFUND">
              {t("admin.entryTypes.REFUND")}
            </SelectItem>
            <SelectItem value="WRITE_OFF">
              {t("admin.entryTypes.WRITE_OFF")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {type === "ADJUSTMENT" ? (
        <div>
          <Label>{t("admin.side")}</Label>
          <Select
            value={side}
            onValueChange={(v) => setSide(v as typeof side)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="credit">{t("admin.sideCredit")}</SelectItem>
              <SelectItem value="debit">{t("admin.sideDebit")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
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
        <Label htmlFor="reasonEn">{t("admin.reasonEn")}</Label>
        <Textarea id="reasonEn" name="reasonEn" required minLength={5} />
      </div>
      <div>
        <Label htmlFor="reasonAr">{t("admin.reasonAr")}</Label>
        <Textarea id="reasonAr" name="reasonAr" required minLength={5} />
      </div>
      <Button type="submit" disabled={pending || !orgId}>
        {t("admin.postEntry")}
      </Button>
    </form>
  );
}
