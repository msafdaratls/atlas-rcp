import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { requirePermission } from "@/lib/rbac";
import { scopedDb } from "@/lib/scoped-db";
import {
  endOfDayInclusive,
  startOfDay,
  statementBalances,
} from "@/lib/statement-balance";
import {
  accumulateAging,
  bucketForDue,
  emptyAging,
  withRunningBalance,
  type AgingSummary,
  type LedgerRowView,
} from "@/server/finance/aging";
import { getOrganisationBalances, sumBalance } from "@/server/finance/ledger";

export type ClientStatementView = {
  organisationNameEn: string;
  organisationNameAr: string;
  balance: number;
  creditLimit: number;
  creditUsedPct: number | null;
  aging: AgingSummary;
  ledger: LedgerRowView[];
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    total: number;
    issuedAt: string | null;
    dueAt: string | null;
  }>;
};

export function invoiceOpenBalance(
  total: Prisma.Decimal,
  allocations: Array<{ amount: Prisma.Decimal }>,
): Prisma.Decimal {
  const paid = allocations.reduce(
    (a, x) => a.plus(x.amount),
    new Prisma.Decimal(0),
  );
  return Prisma.Decimal.max(total.minus(paid), new Prisma.Decimal(0));
}

export async function getClientStatement(input?: {
  from?: string | null;
  to?: string | null;
}): Promise<ClientStatementView | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:client");
    const { organisationId } = scopedDb(session);

    const from = input?.from ? startOfDay(input.from) : null;
    const to = input?.to ? endOfDayInclusive(input.to) : null;
    if (input?.from && !from) return null;
    if (input?.to && !to) return null;

    const [org, allEntries, invoices] = await Promise.all([
      prisma.organisation.findFirst({
        where: { id: organisationId, type: "CLIENT" },
      }),
      prisma.ledgerEntry.findMany({
        where: { organisationId },
        orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.invoice.findMany({
        where: { organisationId },
        include: { allocations: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    if (!org) return null;

    const periodEntries =
      from || to
        ? allEntries.filter((e) => {
            if (from && e.entryDate < from) return false;
            if (to && e.entryDate > to) return false;
            return true;
          })
        : allEntries;

    const { balance, creditUsedPct } = statementBalances({
      allEntries,
      periodEntries,
      creditLimit: org.creditLimit,
    });

    const openingEntries =
      from || to
        ? allEntries.filter((e) => {
            if (from && e.entryDate < from) return true;
            return false;
          })
        : [];
    const openingBalance = sumBalance(openingEntries);

    const aging = emptyAging();
    const now = new Date();
    for (const inv of invoices) {
      if (inv.status === "PAID" || inv.status === "VOID") continue;
      const open = invoiceOpenBalance(inv.total, inv.allocations);
      if (open.isZero()) continue;
      const base = inv.dueAt ?? inv.issuedAt ?? inv.createdAt;
      const due =
        inv.dueAt ??
        new Date(base.getTime() + org.paymentTermsDays * 24 * 60 * 60 * 1000);
      accumulateAging(aging, bucketForDue(due, now), open);
    }

    return {
      organisationNameEn: org.nameEn,
      organisationNameAr: org.nameAr,
      balance: toNumber(balance),
      creditLimit: toNumber(org.creditLimit),
      creditUsedPct,
      aging,
      ledger: withRunningBalance(periodEntries, "client", openingBalance),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        status: inv.status,
        total: toNumber(inv.total),
        issuedAt: inv.issuedAt?.toISOString() ?? null,
        dueAt: inv.dueAt?.toISOString() ?? null,
      })),
    };
  } catch {
    return null;
  }
}

export type AdminFinanceView = {
  pendingPayments: Array<{
    id: string;
    organisationId: string;
    organisationNameEn: string;
    organisationNameAr: string;
    amount: number;
    method: string;
    reference: string | null;
    proofUrl: string | null;
    receivedAt: string;
  }>;
  clientBalances: Array<{
    organisationId: string;
    nameEn: string;
    nameAr: string;
    balance: number;
    creditLimit: number;
    autoHoldWhenOverLimit: boolean;
    daysOverdue: number;
    /** Open (ISSUED/PARTIALLY_PAID) invoices — lets the adjustment form settle a credit note/write-off against a specific one instead of only the org-level ledger. */
    openInvoices: Array<{ id: string; invoiceNo: string; openAmount: number }>;
  }>;
};

export async function getAdminFinanceView(): Promise<AdminFinanceView | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "finance:admin");

    const [pending, clients] = await Promise.all([
      prisma.payment.findMany({
        where: { status: "PENDING_VERIFICATION" },
        include: { organisation: true },
        orderBy: { receivedAt: "asc" },
      }),
      prisma.organisation.findMany({
        where: { type: "CLIENT" },
        include: {
          invoices: {
            where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
            include: { allocations: true },
          },
        },
      }),
    ]);

    const balances = await getOrganisationBalances(clients.map((c) => c.id));

    const { storage } = await import("@/lib/storage");
    const now = new Date();

    return {
      pendingPayments: pending.map((p) => ({
        id: p.id,
        organisationId: p.organisationId,
        organisationNameEn: p.organisation.nameEn,
        organisationNameAr: p.organisation.nameAr,
        amount: toNumber(p.amount),
        method: p.method,
        reference: p.reference,
        proofUrl: p.proofStorageKey
          ? storage.publicUrl(p.proofStorageKey)
          : null,
        receivedAt: p.receivedAt.toISOString(),
      })),
      clientBalances: clients.map((c) => {
        const balance = toNumber(balances.get(c.id) ?? new Prisma.Decimal(0));
        let maxDays = 0;
        const openInvoices: Array<{ id: string; invoiceNo: string; openAmount: number }> = [];
        for (const inv of c.invoices) {
          const open = invoiceOpenBalance(inv.total, inv.allocations);
          if (open.isZero()) continue;
          openInvoices.push({
            id: inv.id,
            invoiceNo: inv.invoiceNo,
            openAmount: toNumber(open),
          });
          const due =
            inv.dueAt ??
            new Date(
              (inv.issuedAt ?? inv.createdAt).getTime() +
                c.paymentTermsDays * 24 * 60 * 60 * 1000,
            );
          const days = Math.floor(
            (now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000),
          );
          if (days > maxDays) maxDays = days;
        }
        return {
          organisationId: c.id,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          balance,
          creditLimit: toNumber(c.creditLimit),
          autoHoldWhenOverLimit: c.autoHoldWhenOverLimit,
          daysOverdue: Math.max(0, maxDays),
          openInvoices,
        };
      }),
    };
  } catch {
    return null;
  }
}
