"use server";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  listNotificationsLimitSchema,
  markNotificationReadSchema,
} from "@/lib/validators/notifications";
import { revalidatePath } from "next/cache";

export type NotificationListItem = {
  id: string;
  type: string;
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function getUnreadNotificationCount(): Promise<number> {
  try {
    const session = await requireSession();
    return prisma.notification.count({
      where: { userId: session.id, readAt: null },
    });
  } catch {
    return 0;
  }
}

export async function listNotifications(limit = 50): Promise<NotificationListItem[]> {
  try {
    const session = await requireSession();
    const parsed = listNotificationsLimitSchema.safeParse(limit);
    const take = parsed.success ? parsed.data : Math.min(Math.max(1, limit), 100);
    return prisma.notification.findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        type: true,
        titleEn: true,
        titleAr: true,
        bodyEn: true,
        bodyAr: true,
        link: true,
        readAt: true,
        createdAt: true,
      },
    });
  } catch {
    return [];
  }
}

export async function markNotificationRead(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    const parsed = markNotificationReadSchema.safeParse({ id });
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const row = await prisma.notification.findFirst({
      where: { id: parsed.data.id, userId: session.id },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (!row.readAt) {
      await prisma.notification.update({
        where: { id: parsed.data.id },
        data: { readAt: new Date() },
      });
    }
    revalidatePath("/[locale]/client/notifications", "page");
    revalidatePath("/[locale]/admin/notifications", "page");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function markAllNotificationsRead(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    await prisma.notification.updateMany({
      where: { userId: session.id, readAt: null },
      data: { readAt: new Date() },
    });
    revalidatePath("/[locale]/client/notifications", "page");
    revalidatePath("/[locale]/admin/notifications", "page");
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") return { ok: false, error: message };
    return { ok: false, error: "SAVE_FAILED" };
  }
}
