import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Tenant-scoped Prisma access. organisationId comes from the session only.
 *
 * Prefer spreading into a Prisma `where` so enum literals keep contextual typing:
 *   where: { ...whereOrg(), state: "DRAFT" }
 * Or pass a fully typed where object when the filter is simple.
 */
export function scopedDb(session: SessionUser) {
  const organisationId = session.organisationId;

  return {
    organisationId,
    prisma,
    whereOrg(
      where: Record<string, unknown> = {},
    ): Record<string, unknown> & { organisationId: string } {
      return { ...where, organisationId };
    },
  };
}
