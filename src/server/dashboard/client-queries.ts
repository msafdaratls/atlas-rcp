import type { RequestState, ReturnReasonCode } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { requirePermission } from "@/lib/rbac";
import { scopedDb } from "@/lib/scoped-db";
import {
  accumulateAging,
  bucketForDue,
  emptyAging,
} from "@/server/finance/aging";
import { sumBalance } from "@/server/finance/ledger";
import { invoiceOpenBalance } from "@/server/finance/queries";

const OPEN_STATES: RequestState[] = [
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "ON_HOLD",
];

const IN_REVIEW_STATES: RequestState[] = [
  "UNDER_INTAKE_REVIEW",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
];

function canPermission(
  session: Awaited<ReturnType<typeof requireSession>>,
  permission: "requests:read" | "finance:client",
): boolean {
  try {
    requirePermission(session, permission);
    return true;
  } catch {
    return false;
  }
}

export type ClientDashboardView = {
  mode: "requests" | "finance";
  attention: Array<{
    id: string;
    requestNo: string;
    productNameEn: string;
    productNameAr: string;
    reasonCode: ReturnReasonCode | null;
    note: string | null;
  }>;
  stats: {
    openRequests: number;
    inReview: number;
    reportsThisYear: number;
    balance: number;
    openInvoiceCount: number;
    overdueAmount: number;
  };
  recentEvents: Array<{
    id: string;
    requestId: string;
    requestNo: string;
    toState: RequestState;
    actorNameEn: string;
    actorNameAr: string;
    createdAt: string;
    note: string | null;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    total: number;
    openAmount: number;
    dueAt: string | null;
  }>;
  categories: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    descEn: string | null;
    descAr: string | null;
  }>;
};

export async function getClientDashboard(): Promise<ClientDashboardView | null> {
  try {
    const session = await requireSession();
    const canRequests = canPermission(session, "requests:read");
    const canFinance = canPermission(session, "finance:client");
    if (!canRequests && !canFinance) return null;

    const { organisationId } = scopedDb(session);
    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    if (!canRequests && canFinance) {
      const [org, ledger, invoices, allOpenInvoices] = await Promise.all([
        prisma.organisation.findFirst({
          where: { id: organisationId, type: "CLIENT" },
        }),
        prisma.ledgerEntry.findMany({
          where: { organisationId },
          select: { debit: true, credit: true },
        }),
        prisma.invoice.findMany({
          where: { organisationId },
          include: { allocations: true },
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
        prisma.invoice.findMany({
          where: {
            organisationId,
            status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          },
          include: { allocations: true },
        }),
      ]);
      if (!org) return null;

      const balance = toNumber(sumBalance(ledger));
      const aging = emptyAging();
      const now = new Date();
      let openInvoiceCount = 0;
      let overdueAmount = 0;

      for (const inv of allOpenInvoices) {
        const open = invoiceOpenBalance(inv.total, inv.allocations);
        if (open.isZero()) continue;
        openInvoiceCount += 1;
        const base = inv.dueAt ?? inv.issuedAt ?? inv.createdAt;
        const due =
          inv.dueAt ??
          new Date(
            base.getTime() + org.paymentTermsDays * 24 * 60 * 60 * 1000,
          );
        const bucket = bucketForDue(due, now);
        accumulateAging(aging, bucket, open);
        if (bucket !== "current") {
          overdueAmount += toNumber(open);
        }
      }

      return {
        mode: "finance",
        attention: [],
        stats: {
          openRequests: 0,
          inReview: 0,
          reportsThisYear: 0,
          balance,
          openInvoiceCount,
          overdueAmount,
        },
        recentEvents: [],
        recentInvoices: invoices.map((inv) => ({
          id: inv.id,
          invoiceNo: inv.invoiceNo,
          status: inv.status,
          total: toNumber(inv.total),
          openAmount: toNumber(invoiceOpenBalance(inv.total, inv.allocations)),
          dueAt: inv.dueAt?.toISOString() ?? null,
        })),
        categories: [],
      };
    }

    const [
      returned,
      openCount,
      inReviewCount,
      reportsCount,
      ledger,
      events,
      mains,
      openInvoices,
    ] = await Promise.all([
      prisma.request.findMany({
        where: { organisationId, state: "RETURNED_TO_CLIENT" },
        orderBy: { updatedAt: "desc" },
        include: {
          events: {
            where: { toState: "RETURNED_TO_CLIENT" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      }),
      prisma.request.count({
        where: { organisationId, state: { in: OPEN_STATES } },
      }),
      prisma.request.count({
        where: { organisationId, state: { in: IN_REVIEW_STATES } },
      }),
      prisma.request.count({
        where: {
          organisationId,
          state: { in: ["REPORT_ISSUED", "CLOSED"] },
          OR: [
            { closedAt: { gte: yearStart } },
            {
              closedAt: null,
              state: "REPORT_ISSUED",
              OR: [
                {
                  events: {
                    some: {
                      toState: "REPORT_ISSUED",
                      createdAt: { gte: yearStart },
                    },
                  },
                },
                { updatedAt: { gte: yearStart } },
              ],
            },
          ],
        },
      }),
      prisma.ledgerEntry.findMany({
        where: { organisationId },
        select: { debit: true, credit: true },
      }),
      prisma.requestEvent.findMany({
        where: { request: { organisationId } },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          request: { select: { id: true, requestNo: true } },
          actor: { select: { fullNameEn: true, fullNameAr: true } },
        },
      }),
      prisma.mainCategory.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.invoice.findMany({
        where: {
          organisationId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        },
        include: { allocations: true },
      }),
    ]);

    let openInvoiceCount = 0;
    let overdueAmount = 0;
    const now = new Date();
    for (const inv of openInvoices) {
      const open = invoiceOpenBalance(inv.total, inv.allocations);
      if (open.isZero()) continue;
      openInvoiceCount += 1;
      if (inv.dueAt && inv.dueAt.getTime() < now.getTime()) {
        overdueAmount += toNumber(open);
      }
    }

    return {
      mode: "requests",
      attention: returned.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        productNameEn: r.productNameEn,
        productNameAr: r.productNameAr,
        reasonCode: r.events[0]?.reasonCode ?? null,
        note: r.events[0]?.note ?? null,
      })),
      stats: {
        openRequests: openCount,
        inReview: inReviewCount,
        reportsThisYear: reportsCount,
        balance: toNumber(sumBalance(ledger)),
        openInvoiceCount,
        overdueAmount,
      },
      recentEvents: events.map((e) => ({
        id: e.id,
        requestId: e.request.id,
        requestNo: e.request.requestNo,
        toState: e.toState,
        actorNameEn: e.actor.fullNameEn,
        actorNameAr: e.actor.fullNameAr,
        createdAt: e.createdAt.toISOString(),
        note: e.note,
      })),
      recentInvoices: [],
      categories: mains.map((m) => ({
        id: m.id,
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        descEn: m.descEn,
        descAr: m.descAr,
      })),
    };
  } catch {
    return null;
  }
}
