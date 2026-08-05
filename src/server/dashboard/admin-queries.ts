import type { RequestState, ReturnReasonCode } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { checkPermission, requirePermission } from "@/lib/rbac";
import { sumBalance } from "@/server/finance/ledger";

const STAGE_GROUPS: Array<{
  key: string;
  states: RequestState[];
  slaTracks: boolean;
}> = [
  {
    key: "intake",
    states: ["SUBMITTED", "UNDER_INTAKE_REVIEW"],
    slaTracks: true,
  },
  {
    key: "assessment",
    states: ["ACCEPTED", "ASSESSMENT_QUEUED", "ASSESSMENT_RUNNING"],
    slaTracks: true,
  },
  { key: "technical", states: ["TECHNICAL_REVIEW"], slaTracks: true },
  { key: "decision", states: ["DECISION"], slaTracks: true },
  { key: "returned", states: ["RETURNED_TO_CLIENT"], slaTracks: false },
  { key: "onHold", states: ["ON_HOLD"], slaTracks: false },
];

function isSlaAtRisk(
  submittedAt: Date,
  slaDueAt: Date,
  now: Date,
): boolean {
  const window = slaDueAt.getTime() - submittedAt.getTime();
  if (window <= 0) return now >= slaDueAt;
  const ratio = (now.getTime() - submittedAt.getTime()) / window;
  return ratio >= 0.8 || now >= slaDueAt;
}

function localMonthLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type AdminDashboardView = {
  queues: Array<{
    key: string;
    depth: number;
    atRisk: number;
  }>;
  receivedVsClosed: Array<{ day: string; received: number; closed: number }>;
  topReturnReasons: Array<{ reason: ReturnReasonCode; count: number }>;
  revenue: {
    original: number;
    resubmission: number;
    monthLabel: string;
  };
  overLimit: Array<{
    organisationId: string;
    nameEn: string;
    nameAr: string;
    balance: number;
    creditLimit: number;
  }>;
};

export async function getAdminDashboard(): Promise<AdminDashboardView | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "admin:dashboard");

    const now = new Date();
    const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const day90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const queues = await Promise.all(
      STAGE_GROUPS.map(async (g) => {
        const depth = await prisma.request.count({
          where: { state: { in: g.states } },
        });
        if (!g.slaTracks) {
          return { key: g.key, depth, atRisk: 0 };
        }
        const candidates = await prisma.request.findMany({
          where: {
            state: { in: g.states },
            slaDueAt: { not: null },
            submittedAt: { not: null },
          },
          select: { submittedAt: true, slaDueAt: true },
        });
        const atRisk = candidates.filter(
          (r) =>
            r.submittedAt &&
            r.slaDueAt &&
            isSlaAtRisk(r.submittedAt, r.slaDueAt, now),
        ).length;
        return { key: g.key, depth, atRisk };
      }),
    );

    const [received, closed] = await Promise.all([
      prisma.request.findMany({
        where: { submittedAt: { gte: day30 } },
        select: { submittedAt: true },
      }),
      prisma.request.findMany({
        where: {
          OR: [
            { closedAt: { gte: day30 } },
            {
              state: "REPORT_ISSUED",
              events: {
                some: {
                  toState: "REPORT_ISSUED",
                  createdAt: { gte: day30 },
                },
              },
            },
            {
              state: "CANCELLED",
              closedAt: null,
              updatedAt: { gte: day30 },
            },
          ],
        },
        select: {
          closedAt: true,
          updatedAt: true,
          state: true,
          events: {
            where: {
              toState: { in: ["REPORT_ISSUED", "CLOSED", "CANCELLED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true, toState: true },
          },
        },
      }),
    ]);

    const byDay = new Map<string, { received: number; closed: number }>();
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      byDay.set(localDayKey(d), { received: 0, closed: 0 });
    }
    for (const r of received) {
      if (!r.submittedAt) continue;
      const row = byDay.get(localDayKey(r.submittedAt));
      if (row) row.received += 1;
    }
    for (const r of closed) {
      const when =
        r.closedAt ??
        r.events[0]?.createdAt ??
        (r.state === "CANCELLED" ? r.updatedAt : null);
      if (!when || when < day30) continue;
      const row = byDay.get(localDayKey(when));
      if (row) row.closed += 1;
    }

    const returnEvents = await prisma.$queryRaw<
      Array<{ reason: ReturnReasonCode; count: bigint }>
    >`
      SELECT unnest("reasonCodes") AS reason, COUNT(*) AS count
      FROM "RequestEvent"
      WHERE "toState" = 'RETURNED_TO_CLIENT' AND "createdAt" >= ${day90}
      GROUP BY reason
      ORDER BY count DESC
      LIMIT 8
    `;

    const canSeeFinance =
      checkPermission(session, "analytics:finance") ||
      checkPermission(session, "finance:admin");

    let revenue: AdminDashboardView["revenue"] = {
      original: 0,
      resubmission: 0,
      monthLabel: localMonthLabel(monthStart),
    };
    let overLimit: AdminDashboardView["overLimit"] = [];

    if (canSeeFinance) {
      const monthInvoices = await prisma.invoice.findMany({
        where: {
          status: { in: ["ISSUED", "PAID", "PARTIALLY_PAID"] },
          issuedAt: { gte: monthStart },
          requestId: { not: null },
        },
        include: { request: { select: { submissionNo: true } } },
      });

      let original = new Prisma.Decimal(0);
      let resubmission = new Prisma.Decimal(0);
      for (const inv of monthInvoices) {
        if ((inv.request?.submissionNo ?? 1) > 1) {
          resubmission = resubmission.plus(inv.total);
        } else {
          original = original.plus(inv.total);
        }
      }

      const clients = await prisma.organisation.findMany({
        where: { type: "CLIENT", creditLimit: { gt: 0 } },
        include: {
          ledgerEntries: { select: { debit: true, credit: true } },
        },
      });

      overLimit = clients
        .map((c) => ({
          organisationId: c.id,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          balance: toNumber(sumBalance(c.ledgerEntries)),
          creditLimit: toNumber(c.creditLimit),
        }))
        .filter((c) => c.balance > c.creditLimit)
        .sort((a, b) => b.balance - a.balance);

      revenue = {
        original: toNumber(original),
        resubmission: toNumber(resubmission),
        monthLabel: localMonthLabel(monthStart),
      };
    }

    return {
      queues,
      receivedVsClosed: [...byDay.entries()].map(([day, v]) => ({
        day,
        received: v.received,
        closed: v.closed,
      })),
      topReturnReasons: returnEvents.map((r) => ({
        reason: r.reason,
        count: Number(r.count),
      })),
      revenue,
      overLimit,
    };
  } catch {
    return null;
  }
}
