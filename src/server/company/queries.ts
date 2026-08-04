import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { PREFERENCE_EVENTS } from "@/lib/notification-events";
import { requirePermission } from "@/lib/rbac";
import { scopedDb } from "@/lib/scoped-db";
import { storage } from "@/lib/storage";

export type CompanyProfileView = {
  canEdit: boolean;
  canManageUsers: boolean;
  organisation: {
    id: string;
    clientCategory: string | null;
    isInternational: boolean;
    nameEn: string;
    nameAr: string;
    logoKey: string | null;
    logoUrl: string | null;
    email: string;
    phone: string | null;
    website: string | null;
    crNumber: string | null;
    vatNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string;
    nationalAddress: string | null;
  };
  users: Array<{
    id: string;
    email: string;
    fullNameEn: string;
    fullNameAr: string;
    status: string;
    lastLoginAt: string | null;
    roles: string[];
    isSelf: boolean;
  }>;
  preferences: {
    locale: string;
    notifications: Array<{
      eventType: (typeof PREFERENCE_EVENTS)[number]["type"];
      emailEnabled: boolean;
      inAppEnabled: boolean;
      locked: boolean;
    }>;
  };
};

export type CompanyProfileLoad =
  | { status: "ok"; data: CompanyProfileView }
  | {
      status: "error";
      reason: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_CLIENT" | "UNAVAILABLE";
    };

export async function getCompanyProfilePageData(): Promise<CompanyProfileLoad> {
  try {
    const session = await requireSession();
    if (session.organisation.type !== "CLIENT") {
      return { status: "error", reason: "NOT_CLIENT" };
    }
    requirePermission(session, "company:read");
    const { organisationId } = scopedDb(session);

    const [organisation, users, prefs] = await Promise.all([
      prisma.organisation.findFirst({
        where: { id: organisationId, type: "CLIENT" },
      }),
      prisma.user.findMany({
        where: { organisationId },
        include: { roles: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.notificationPreference.findMany({
        where: { userId: session.id },
      }),
    ]);

    if (!organisation) return { status: "error", reason: "UNAVAILABLE" };

    const canManageUsers = session.roles.includes("CLIENT_OWNER");
    const canEdit = canManageUsers;
    const prefMap = new Map(prefs.map((p) => [p.eventType, p]));

    return {
      status: "ok",
      data: {
        canEdit,
        canManageUsers,
        organisation: {
          id: organisation.id,
          clientCategory: organisation.clientCategory,
          isInternational: organisation.isInternational,
          nameEn: organisation.nameEn,
          nameAr: organisation.nameAr,
          logoKey: organisation.logoKey,
          logoUrl: organisation.logoKey
            ? storage.publicUrl(organisation.logoKey)
            : null,
          email: organisation.email,
          phone: organisation.phone,
          website: organisation.website,
          crNumber: organisation.crNumber,
          vatNumber: organisation.vatNumber,
          addressLine1: organisation.addressLine1,
          addressLine2: organisation.addressLine2,
          city: organisation.city,
          region: organisation.region,
          postalCode: organisation.postalCode,
          country: organisation.country,
          nationalAddress: organisation.nationalAddress,
        },
        users: canManageUsers
          ? users.map((u) => ({
              id: u.id,
              email: u.email,
              fullNameEn: u.fullNameEn,
              fullNameAr: u.fullNameAr,
              status: u.status,
              lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
              roles: u.roles.map((r) => r.role),
              isSelf: u.id === session.id,
            }))
          : [],
        preferences: {
          locale: session.locale === "en" ? "en" : "ar",
          notifications: PREFERENCE_EVENTS.map((event) => {
            const existing = prefMap.get(event.type);
            return {
              eventType: event.type,
              emailEnabled: event.legalFinancial
                ? true
                : (existing?.emailEnabled ?? true),
              inAppEnabled: event.legalFinancial
                ? true
                : (existing?.inAppEnabled ?? true),
              locked: event.legalFinancial,
            };
          }),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") {
      return { status: "error", reason: "UNAUTHORIZED" };
    }
    if (message === "FORBIDDEN") {
      return { status: "error", reason: "FORBIDDEN" };
    }
    return { status: "error", reason: "UNAVAILABLE" };
  }
}
