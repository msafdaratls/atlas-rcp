import { render } from "@react-email/render";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  isNotificationEventType,
  type NotificationEventType,
} from "@/lib/notification-events";
import {
  emailSubject,
  renderEventEmailElement,
  renderPlainText,
  type EmailTemplatePayload,
} from "@/emails/render-event-email";
import { getEmailAdapter } from "@/server/notifications/email-adapter";

const BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
];

function asPayload(value: Prisma.JsonValue): EmailTemplatePayload {
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    requestNo: typeof obj.requestNo === "string" ? obj.requestNo : null,
    state: typeof obj.state === "string" ? obj.state : null,
    link: typeof obj.link === "string" ? obj.link : "/",
    titleEn: typeof obj.titleEn === "string" ? obj.titleEn : "Atlas COC",
    titleAr: typeof obj.titleAr === "string" ? obj.titleAr : "أطلس",
    bodyEn: typeof obj.bodyEn === "string" ? obj.bodyEn : "",
    bodyAr: typeof obj.bodyAr === "string" ? obj.bodyAr : "",
    ctaLabelEn: typeof obj.ctaLabelEn === "string" ? obj.ctaLabelEn : undefined,
    ctaLabelAr: typeof obj.ctaLabelAr === "string" ? obj.ctaLabelAr : undefined,
    stateLabelEn:
      typeof obj.stateLabelEn === "string" ? obj.stateLabelEn : undefined,
    stateLabelAr:
      typeof obj.stateLabelAr === "string" ? obj.stateLabelAr : undefined,
  };
}

export async function processOutboxBatch(limit = 20): Promise<number> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);

  // Reclaim stuck PROCESSING rows (worker crash / deploy mid-send).
  await prisma.notificationOutbox.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      nextAttemptAt: now,
    },
  });

  const pending = await prisma.notificationOutbox.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: now },
      channel: "EMAIL",
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let processed = 0;
  const adapter = getEmailAdapter();

  for (const row of pending) {
    const claimed = await prisma.notificationOutbox.updateMany({
      where: { id: row.id, status: "PENDING" },
      data: { status: "PROCESSING", updatedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    const locale = row.locale === "en" ? "en" : "ar";
    const event: NotificationEventType = isNotificationEventType(row.eventType)
      ? row.eventType
      : "REQUEST_SUBMITTED";
    const payload = asPayload(row.payload);

    try {
      const element = renderEventEmailElement(event, locale, payload);
      const html = await render(element);
      const text = renderPlainText(locale, payload);
      const subject = emailSubject(event, locale, payload);
      const { messageId } = await adapter.send({
        to: row.recipient,
        subject,
        html,
        text,
      });

      await prisma.$transaction([
        prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            providerMessageId: messageId,
            lastError: null,
            attempts: { increment: 1 },
          },
        }),
        prisma.notificationLog.create({
          data: {
            channel: "EMAIL",
            recipient: row.recipient,
            template: row.eventType,
            status: "SENT",
            providerMessageId: messageId,
          },
        }),
      ]);
      processed += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const message =
        error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
      const dead = attempts >= BACKOFF_MS.length;
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;

      await prisma.$transaction([
        prisma.notificationOutbox.update({
          where: { id: row.id },
          data: {
            status: dead ? "FAILED" : "PENDING",
            attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: dead ? new Date() : new Date(Date.now() + delay),
          },
        }),
        prisma.notificationLog.create({
          data: {
            channel: "EMAIL",
            recipient: row.recipient,
            template: row.eventType,
            status: dead ? "FAILED" : "RETRY",
            error: message.slice(0, 500),
          },
        }),
      ]);
    }
  }

  return processed;
}
