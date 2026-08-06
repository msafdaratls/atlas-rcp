"use server";

import { cookies } from "next/headers";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { ACTING_ORG_COOKIE } from "@/lib/request-context";
import { requestMeta, writeAuditLog } from "@/lib/audit";

export type OnBehalfResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Pins the acting Atlas staff member to a client organisation so the shared
 * new-request wizard creates the request for that client. Validates the caller
 * has `requests:create-behalf` and that the target is an active client org.
 */
export async function startRequestOnBehalf(
  organisationId: string,
): Promise<OnBehalfResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create-behalf");

    const org = await prisma.organisation.findFirst({
      where: { id: organisationId, type: "CLIENT", status: "ACTIVE" },
      select: { id: true },
    });
    if (!org) return { ok: false, error: "CLIENT_NOT_FOUND" };

    const store = await cookies();
    store.set(ACTING_ORG_COOKIE, org.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Short-lived — long enough to complete one request, not a standing grant.
      maxAge: 60 * 60 * 2,
    });

    const meta = await requestMeta();
    await writeAuditLog({
      session,
      action: "requests.onBehalf.start",
      entityType: "Organisation",
      entityId: org.id,
      organisationId: org.id,
      ...meta,
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "FAILED" };
  }
}

/** Clears the acting-org pin (finished, or switching clients). */
export async function endRequestOnBehalf(): Promise<OnBehalfResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create-behalf");
    const store = await cookies();
    const pinnedOrgId = store.get(ACTING_ORG_COOKIE)?.value;
    store.delete(ACTING_ORG_COOKIE);

    if (pinnedOrgId) {
      const meta = await requestMeta();
      await writeAuditLog({
        session,
        action: "requests.onBehalf.end",
        entityType: "Organisation",
        entityId: pinnedOrgId,
        organisationId: pinnedOrgId,
        ...meta,
      });
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "FAILED" };
  }
}
