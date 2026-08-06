"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import type { ActionResult } from "@/server/admin/actions";

export type EngagementListItem = {
  id: string;
  status: "ACTIVE" | "PAUSED" | "CLOSED";
  startedAt: string;
  closedAt: string | null;
  organisation: { id: string; nameEn: string; nameAr: string };
  serviceItem: { id: string; nameEn: string; nameAr: string };
  requestCount: number;
};

export type EngagementDetail = EngagementListItem & {
  notes: string | null;
  requests: Array<{
    id: string;
    requestNo: string;
    state: string;
    createdAt: string;
  }>;
};

export async function listEngagements(): Promise<EngagementListItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const rows = await prisma.engagement.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        organisation: { select: { id: true, nameEn: true, nameAr: true } },
        serviceItem: { select: { id: true, nameEn: true, nameAr: true } },
        _count: { select: { requests: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      organisation: r.organisation,
      serviceItem: r.serviceItem,
      requestCount: r._count.requests,
    }));
  } catch {
    return null;
  }
}

export async function getEngagementDetail(
  engagementId: string,
): Promise<EngagementDetail | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const r = await prisma.engagement.findUnique({
      where: { id: engagementId },
      include: {
        organisation: { select: { id: true, nameEn: true, nameAr: true } },
        serviceItem: { select: { id: true, nameEn: true, nameAr: true } },
        requests: {
          orderBy: { createdAt: "desc" },
          select: { id: true, requestNo: true, state: true, createdAt: true },
        },
      },
    });
    if (!r) return null;

    return {
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      closedAt: r.closedAt?.toISOString() ?? null,
      organisation: r.organisation,
      serviceItem: r.serviceItem,
      requestCount: r.requests.length,
      notes: r.notes,
      requests: r.requests.map((req) => ({
        id: req.id,
        requestNo: req.requestNo,
        state: req.state,
        createdAt: req.createdAt.toISOString(),
      })),
    };
  } catch {
    return null;
  }
}

const createEngagementSchema = z.object({
  organisationId: z.string().min(1),
  serviceItemId: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
});

/** Opens a new retainer (e.g. a SABER Account Management engagement) for a client. */
export async function createEngagement(
  input: z.infer<typeof createEngagementSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = createEngagementSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const org = await prisma.organisation.findFirst({
      where: { id: parsed.data.organisationId, type: "CLIENT", status: "ACTIVE" },
      select: { id: true },
    });
    if (!org) return { ok: false, error: "CLIENT_NOT_FOUND" };

    const serviceItem = await prisma.serviceItem.findFirst({
      where: { id: parsed.data.serviceItemId, active: true },
      select: { id: true },
    });
    if (!serviceItem) return { ok: false, error: "SERVICE_NOT_FOUND" };

    const meta = await requestMeta();
    const engagement = await prisma.$transaction(async (tx) => {
      const created = await tx.engagement.create({
        data: {
          organisationId: org.id,
          serviceItemId: serviceItem.id,
          notes: parsed.data.notes || null,
          createdByUserId: session.id,
        },
      });
      await writeAuditLog({
        session,
        organisationId: org.id,
        action: "engagement.create",
        entityType: "Engagement",
        entityId: created.id,
        after: { serviceItemId: serviceItem.id },
        tx,
        ...meta,
      });
      return created;
    });

    revalidatePath("/[locale]/admin/engagements", "page");
    return { ok: true, data: { id: engagement.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const closeEngagementSchema = z.object({
  engagementId: z.string().min(1),
});

export async function closeEngagement(
  input: z.infer<typeof closeEngagementSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = closeEngagementSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const engagement = await prisma.engagement.findUnique({
      where: { id: parsed.data.engagementId },
      select: { id: true, organisationId: true, status: true },
    });
    if (!engagement) return { ok: false, error: "NOT_FOUND" };
    if (engagement.status === "CLOSED") {
      return { ok: false, error: "ALREADY_CLOSED" };
    }

    const meta = await requestMeta();
    await prisma.$transaction(async (tx) => {
      await tx.engagement.update({
        where: { id: engagement.id },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      await writeAuditLog({
        session,
        organisationId: engagement.organisationId,
        action: "engagement.close",
        entityType: "Engagement",
        entityId: engagement.id,
        tx,
        ...meta,
      });
    });

    revalidatePath("/[locale]/admin/engagements", "page");
    revalidatePath(`/[locale]/admin/engagements/${engagement.id}`, "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
