import type { RequestState } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { slaDedupeKey, slaNotifyLink } from "@/lib/sla";
import { notificationCopy } from "@/server/notifications/copy";
import { notify } from "@/server/notifications/notify";

const PAUSED: RequestState[] = [
  "DRAFT",
  "RETURNED_TO_CLIENT",
  "ON_HOLD",
  "CLOSED",
  "CANCELLED",
  "REPORT_ISSUED",
];

function openInvoiceBalance(
  total: Prisma.Decimal,
  allocations: Array<{ amount: Prisma.Decimal }>,
): Prisma.Decimal {
  const paid = allocations.reduce(
    (a, x) => a.plus(x.amount),
    new Prisma.Decimal(0),
  );
  return Prisma.Decimal.max(total.minus(paid), new Prisma.Decimal(0));
}

/**
 * Scan active requests for SLA_AT_RISK (≥80% elapsed) and SLA_BREACHED.
 * Skips RETURNED_TO_CLIENT / ON_HOLD — clock paused while client holds.
 */
export async function scanSlaNotifications(): Promise<{
  atRisk: number;
  breached: number;
}> {
  const now = new Date();
  const requests = await prisma.request.findMany({
    where: {
      slaDueAt: { not: null },
      submittedAt: { not: null },
      state: { notIn: PAUSED },
    },
    select: {
      id: true,
      requestNo: true,
      state: true,
      organisationId: true,
      createdByUserId: true,
      assignedToUserId: true,
      submittedAt: true,
      slaDueAt: true,
    },
  });

  let atRisk = 0;
  let breached = 0;

  for (const req of requests) {
    if (!req.submittedAt || !req.slaDueAt) continue;
    const windowMs = req.slaDueAt.getTime() - req.submittedAt.getTime();
    if (windowMs <= 0) continue;
    const elapsed = now.getTime() - req.submittedAt.getTime();
    const ratio = elapsed / windowMs;
    const pastDue = now.getTime() > req.slaDueAt.getTime();

    if (pastDue) {
      await prisma.$transaction(async (tx) => {
        await notify(
          {
            event: "SLA_BREACHED",
            data: {
              requestId: req.id,
              requestNo: req.requestNo,
              state: req.state,
              link: slaNotifyLink(req.id, req.submittedAt!),
              organisationId: req.organisationId,
              createdByUserId: req.createdByUserId,
              assignedToUserId: req.assignedToUserId,
              dedupeKey: slaDedupeKey("SLA_BREACHED", req.id, req.submittedAt!),
              ...notificationCopy("SLA_BREACHED", {
                requestNo: req.requestNo,
              }),
            },
          },
          tx,
        );
      });
      breached += 1;
      continue;
    }

    if (ratio >= 0.8) {
      await prisma.$transaction(async (tx) => {
        await notify(
          {
            event: "SLA_AT_RISK",
            data: {
              requestId: req.id,
              requestNo: req.requestNo,
              state: req.state,
              link: slaNotifyLink(req.id, req.submittedAt!),
              organisationId: req.organisationId,
              createdByUserId: req.createdByUserId,
              assignedToUserId: req.assignedToUserId,
              dedupeKey: slaDedupeKey("SLA_AT_RISK", req.id, req.submittedAt!),
              ...notificationCopy("SLA_AT_RISK", {
                requestNo: req.requestNo,
              }),
            },
          },
          tx,
        );
      });
      atRisk += 1;
    }
  }

  return { atRisk, breached };
}

/**
 * Emit STATEMENT_OVERDUE for open invoices past dueAt (deduped per invoice).
 */
export async function scanStatementOverdue(): Promise<{ notified: number }> {
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      dueAt: { lt: now },
    },
    include: {
      allocations: { select: { amount: true } },
    },
  });

  let notified = 0;

  for (const inv of invoices) {
    const open = openInvoiceBalance(inv.total, inv.allocations);
    if (open.isZero()) continue;

    await prisma.$transaction(async (tx) => {
      await notify(
        {
          event: "STATEMENT_OVERDUE",
          data: {
            organisationId: inv.organisationId,
            requestId: inv.requestId ?? undefined,
            link: `/client/statement?invoice=${inv.id}`,
            dedupeKey: `STATEMENT_OVERDUE:${inv.id}`,
            ...notificationCopy("STATEMENT_OVERDUE", {
              invoiceNo: inv.invoiceNo,
              amount: toNumber(open).toFixed(2),
            }),
          },
        },
        tx,
      );
    });
    notified += 1;
  }

  return { notified };
}
