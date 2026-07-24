import type { Prisma, Role } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

export type AuditLogRow = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  actorRole: Role | null;
  organisationName: string | null;
};

export type AuditLogView = {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  actions: string[];
};

const PAGE_SIZE = 50;

/**
 * Compliance audit-log reader (audit:read → SYSTEM_ADMIN / QUALITY_MANAGER).
 * Read-only, newest first, optional filters by action and entity type.
 */
export async function getAuditLogView(input: {
  page?: number;
  action?: string;
  entityType?: string;
}): Promise<AuditLogView> {
  const session = await requireSession();
  requirePermission(session, "audit:read");

  const page = Math.max(1, input.page ?? 1);
  const where: Prisma.AuditLogWhereInput = {};
  if (input.action) where.action = input.action;
  if (input.entityType) where.entityType = input.entityType;

  const [total, logs, distinctActions] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        actorRole: true,
        actor: { select: { fullNameEn: true, fullNameAr: true } },
        organisation: { select: { nameEn: true } },
      },
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: 200,
    }),
  ]);

  return {
    rows: logs.map((l) => ({
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      action: l.action,
      entityType: l.entityType,
      entityId: l.entityId,
      actorName: l.actor?.fullNameEn ?? null,
      actorRole: l.actorRole,
      organisationName: l.organisation?.nameEn ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    actions: distinctActions.map((a) => a.action),
  };
}
