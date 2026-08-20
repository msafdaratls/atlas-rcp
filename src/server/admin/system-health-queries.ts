import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

export type FailedOutboxRow = {
  id: string;
  eventType: string;
  channel: string;
  recipient: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

export type FailedExtractionRow = {
  id: string;
  assessmentId: string;
  requestNo: string | null;
  organisationName: string | null;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
};

export type SystemHealthView = {
  outboxFailedCount: number;
  outboxPendingCount: number;
  extractionFailedCount: number;
  outboxFailed: FailedOutboxRow[];
  extractionFailed: FailedExtractionRow[];
};

const ROW_LIMIT = 25;

/**
 * Surfaces background-job rows that have run out of retries and dead-lettered
 * silently — the notification outbox and the label-eval extraction queue both
 * retire failed rows to a terminal status (FAILED/ERROR per their worker's
 * dead-letter logic) but nothing in the app previously read that state back
 * out, so a stuck SMTP or Anthropic credential could fail every job forever
 * with no operator ever finding out short of a client complaint.
 */
export async function getSystemHealthView(): Promise<SystemHealthView> {
  const session = await requireSession();
  requirePermission(session, "system:health");

  const [
    outboxFailedCount,
    outboxPendingCount,
    extractionFailedCount,
    outboxFailed,
    extractionFailed,
  ] = await Promise.all([
    prisma.notificationOutbox.count({ where: { status: "FAILED" } }),
    prisma.notificationOutbox.count({ where: { status: "PENDING" } }),
    prisma.labelExtractionJob.count({ where: { status: "FAILED" } }),
    prisma.notificationOutbox.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true,
        eventType: true,
        channel: true,
        recipient: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    prisma.labelExtractionJob.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: ROW_LIMIT,
      select: {
        id: true,
        assessmentId: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
        assessment: { select: { requestNo: true, organisationName: true } },
      },
    }),
  ]);

  return {
    outboxFailedCount,
    outboxPendingCount,
    extractionFailedCount,
    outboxFailed: outboxFailed.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      channel: row.channel,
      recipient: row.recipient,
      attempts: row.attempts,
      lastError: row.lastError,
      updatedAt: row.updatedAt.toISOString(),
    })),
    extractionFailed: extractionFailed.map((row) => ({
      id: row.id,
      assessmentId: row.assessmentId,
      requestNo: row.assessment?.requestNo ?? null,
      organisationName: row.assessment?.organisationName ?? null,
      attempts: row.attempts,
      lastError: row.lastError,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
