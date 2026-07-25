import { cookies } from "next/headers";
import type { Role } from "@prisma/client";

import { requireSession, type SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

/**
 * Cookie that pins an Atlas staff member to a client organisation while they
 * create a request on that client's behalf. Set/cleared by the admin
 * on-behalf server actions; validated on every read here.
 */
export const ACTING_ORG_COOKIE = "coc_acting_org";

export type RequestContext = {
  /** The signed-in user (a client, or the Atlas admin acting on behalf). */
  session: SessionUser;
  /** Organisation the request belongs to (the client's org either way). */
  organisationId: string;
  /** User recorded as the actor for events/audit (the real signed-in user). */
  actorUserId: string;
  actorRole: Role;
  /** True when an Atlas staff member is acting for a client organisation. */
  onBehalf: boolean;
};

/**
 * Resolves who a request-creation action is acting as and for which org.
 *
 * - A CLIENT user acts for their own organisation (unchanged behaviour).
 * - An ATLAS staff member with `requests:create-behalf` acts for the client
 *   organisation pinned in the acting-org cookie. The staff member stays the
 *   audit actor; only the target organisation changes.
 *
 * Throws FORBIDDEN when the caller may not create requests, or when an Atlas
 * user has no valid acting-org selected.
 */
export async function resolveRequestContext(): Promise<RequestContext> {
  const session = await requireSession();

  if (session.organisation.type === "CLIENT") {
    requirePermission(session, "requests:create");
    return {
      session,
      organisationId: session.organisationId,
      actorUserId: session.id,
      actorRole: (session.roles[0] as Role) ?? "CLIENT_USER",
      onBehalf: false,
    };
  }

  // Atlas staff acting on behalf of a client organisation.
  requirePermission(session, "requests:create-behalf");
  const store = await cookies();
  const orgId = store.get(ACTING_ORG_COOKIE)?.value;
  if (!orgId) throw new Error("FORBIDDEN");

  const org = await prisma.organisation.findFirst({
    where: { id: orgId, type: "CLIENT", status: "ACTIVE" },
    select: { id: true },
  });
  if (!org) throw new Error("FORBIDDEN");

  return {
    session,
    organisationId: org.id,
    actorUserId: session.id,
    actorRole: (session.roles[0] as Role) ?? "SYSTEM_ADMIN",
    onBehalf: true,
  };
}
