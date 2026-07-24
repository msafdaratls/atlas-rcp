import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";

export async function writeAuditLog(input: {
  session: SessionUser;
  action: string;
  entityType: string;
  entityId: string;
  /** Tenant org when known (client request, payment org, etc.). */
  organisationId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const primaryRole = input.session.roles[0] as Role | undefined;
  await prisma.auditLog.create({
    data: {
      actorUserId: input.session.id,
      actorRole: primaryRole,
      organisationId:
        input.organisationId ?? input.session.organisationId ?? undefined,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
      ip: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
    },
  });
}

export function diffKeys<T extends Record<string, unknown>>(
  before: T,
  after: T,
  labels: Partial<Record<keyof T, string>>,
): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(after) as (keyof T)[]) {
    const a = before[key];
    const b = after[key];
    const same =
      a === b ||
      (a == null && b == null) ||
      String(a ?? "") === String(b ?? "");
    if (!same) {
      changed.push(labels[key] ?? String(key));
    }
  }
  return changed;
}
