import type { Role } from "@prisma/client";

import { auth } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email: string;
  organisationId: string;
  fullNameEn: string;
  fullNameAr: string;
  locale: string;
  roles: Role[];
  organisation: {
    id: string;
    nameEn: string;
    nameAr: string;
    logoKey: string | null;
    type: "CLIENT" | "ATLAS";
  };
};

/**
 * Auth.js session mapped to the app SessionUser shape used by RBAC / shells.
 * JWT is revalidated against the DB in `auth.ts` (inactive/missing → no session).
 */
export async function getSession(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organisationId) {
    return null;
  }

  const u = session.user;
  return {
    id: u.id,
    email: u.email ?? "",
    organisationId: u.organisationId,
    fullNameEn: u.fullNameEn,
    fullNameAr: u.fullNameAr,
    locale: u.locale ?? "ar",
    roles: u.roles ?? [],
    organisation: {
      id: u.organisationId,
      nameEn: u.orgNameEn,
      nameAr: u.orgNameAr,
      logoKey: u.orgLogoKey ?? null,
      type: u.orgType,
    },
  };
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
