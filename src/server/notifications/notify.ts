import type { Prisma } from "@prisma/client";
import {
  isLegalFinancialEvent,
  type NotificationEventType,
} from "@/lib/notification-events";
import {
  resolveRecipients,
  type NotifyContext,
  type TxClient,
} from "@/server/notifications/recipients";

export type NotifyData = {
  requestId?: string;
  requestNo?: string;
  state?: string;
  /** Locale-agnostic path starting with /client or /admin */
  link: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  dedupeKey?: string;
  organisationId?: string;
  createdByUserId?: string;
  assignedToUserId?: string | null;
  commentDirection?: NotifyContext["commentDirection"];
  ctaLabelEn?: string;
  ctaLabelAr?: string;
};

export type NotifyInput = {
  event: NotificationEventType;
  recipients?: string[];
  data: NotifyData;
};

function normalizeLocale(locale: string): "ar" | "en" {
  return locale === "en" ? "en" : "ar";
}

/**
 * Enqueue in-app notifications and email outbox rows inside `tx`.
 * Never sends SMTP here — the worker drains the outbox.
 */
export async function notify(
  input: NotifyInput,
  tx: TxClient,
): Promise<{ inApp: number; emailQueued: number }> {
  const ctx: NotifyContext = {
    organisationId: input.data.organisationId,
    requestId: input.data.requestId,
    createdByUserId: input.data.createdByUserId,
    assignedToUserId: input.data.assignedToUserId,
    commentDirection: input.data.commentDirection,
  };

  const users = await resolveRecipients(
    tx,
    input.event,
    ctx,
    input.recipients,
  );

  if (users.length === 0) {
    return { inApp: 0, emailQueued: 0 };
  }

  const prefs = await tx.notificationPreference.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      eventType: input.event,
    },
  });
  const prefMap = new Map(
    prefs.map((p) => [`${p.userId}:${p.eventType}`, p] as const),
  );

  let inApp = 0;
  let emailQueued = 0;
  const forceEmail = isLegalFinancialEvent(input.event);

  for (const user of users) {
    const pref = prefMap.get(`${user.id}:${input.event}`);
    const inAppEnabled = pref?.inAppEnabled ?? true;
    const emailEnabled = forceEmail || (pref?.emailEnabled ?? true);

    if (inAppEnabled) {
      let skipInApp = false;
      if (input.data.dedupeKey) {
        // Dedupe by event type + link (SLA links are cycle-unique via
        // submittedAt; CREDIT_LIMIT uses a stable statement link).
        const existingInApp = await tx.notification.findFirst({
          where: {
            userId: user.id,
            type: input.event,
            link: input.data.link,
          },
          select: { id: true },
        });
        skipInApp = Boolean(existingInApp);
      }

      if (!skipInApp) {
        await tx.notification.create({
          data: {
            userId: user.id,
            type: input.event,
            titleEn: input.data.titleEn,
            titleAr: input.data.titleAr,
            bodyEn: input.data.bodyEn,
            bodyAr: input.data.bodyAr,
            link: input.data.link,
          },
        });
        inApp += 1;

        await tx.notificationLog.create({
          data: {
            channel: "IN_APP",
            recipient: user.id,
            template: input.event,
            status: "SENT",
          },
        });
      }
    }

    if (emailEnabled && user.email) {
      const locale = normalizeLocale(user.locale);
      const dedupeKey = input.data.dedupeKey
        ? `${input.data.dedupeKey}:${user.id}`
        : undefined;

      if (dedupeKey) {
        const existing = await tx.notificationOutbox.findUnique({
          where: { dedupeKey },
          select: { id: true },
        });
        if (existing) continue;
      }

      const payload: Prisma.InputJsonValue = {
        requestId: input.data.requestId ?? null,
        requestNo: input.data.requestNo ?? null,
        state: input.data.state ?? null,
        link: input.data.link,
        titleEn: input.data.titleEn,
        titleAr: input.data.titleAr,
        bodyEn: input.data.bodyEn,
        bodyAr: input.data.bodyAr,
        ctaLabelEn: input.data.ctaLabelEn ?? "Open request",
        ctaLabelAr: input.data.ctaLabelAr ?? "فتح الطلب",
        recipientNameEn: user.fullNameEn,
        recipientNameAr: user.fullNameAr,
      };

      try {
        await tx.notificationOutbox.create({
          data: {
            eventType: input.event,
            channel: "EMAIL",
            userId: user.id,
            recipient: user.email,
            locale,
            payload,
            dedupeKey,
            status: "PENDING",
            nextAttemptAt: new Date(),
          },
        });
        emailQueued += 1;

        await tx.notificationLog.create({
          data: {
            channel: "EMAIL",
            recipient: user.email,
            template: input.event,
            status: "QUEUED",
          },
        });
      } catch (error) {
        // Unique dedupe race — treat as already queued
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: string }).code)
            : "";
        if (code !== "P2002") throw error;
      }
    }
  }

  return { inApp, emailQueued };
}
