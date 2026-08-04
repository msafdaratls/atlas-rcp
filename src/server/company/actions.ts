"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { sendInviteEmail } from "@/lib/auth/auth-email";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { writeAuditLog, diffKeys, requestMeta } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { isLegalFinancialEvent } from "@/lib/notification-events";
import { mimeAllowed, sniffMime } from "@/lib/mime-sniff";
import { hasRole, requirePermission } from "@/lib/rbac";
import { scopedDb } from "@/lib/scoped-db";
import { storage } from "@/lib/storage";
import {
  buildCompanyProfileSchema,
  changeUserRoleSchema,
  deactivateUserSchema,
  inviteUserSchema,
  logoUploadMetaSchema,
  preferencesSchema,
  type CompanyProfileValues,
  type InviteUserInput,
  type PreferencesInput,
} from "@/lib/validators/company";

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ActionResult<T = undefined> =
  | { ok: true; data: T; updatedFields?: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function mapZodError(error: {
  flatten: () => { fieldErrors: Record<string, string[] | undefined> };
}): Record<string, string[]> {
  const flat = error.flatten().fieldErrors;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(flat)) {
    if (v && v.length) out[k] = v;
  }
  return out;
}

const PROFILE_LABELS: Partial<Record<keyof CompanyProfileValues, string>> = {
  nameEn: "nameEn",
  nameAr: "nameAr",
  crNumber: "crNumber",
  vatNumber: "vatNumber",
  website: "website",
  email: "email",
  phone: "phone",
  addressLine1: "addressLine1",
  addressLine2: "addressLine2",
  city: "city",
  region: "region",
  postalCode: "postalCode",
  country: "country",
  nationalAddress: "nationalAddress",
};

export async function saveCompanyProfile(
  input: CompanyProfileValues,
): Promise<ActionResult<{ logoUrl: string | null }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "company:write");

    const { organisationId: orgId } = scopedDb(session);
    const before = await prisma.organisation.findFirst({
      where: { id: orgId, type: "CLIENT" },
    });
    if (!before) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const requiresSaudiFields =
      before.clientCategory === "COMPANY" && !before.isInternational;
    const parsed = buildCompanyProfileSchema(requiresSaudiFields).safeParse(
      input,
    );
    if (!parsed.success) {
      return {
        ok: false,
        error: "VALIDATION",
        fieldErrors: mapZodError(parsed.error),
      };
    }

    const data = parsed.data;
    const after = await prisma.organisation.update({
      where: { id: orgId },
      data: {
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        crNumber: data.crNumber || null,
        vatNumber: data.vatNumber || null,
        website: data.website,
        email: data.email,
        phone: data.phone,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2 ?? null,
        city: data.city,
        region: data.region,
        postalCode: data.postalCode,
        country: data.country,
        nationalAddress: data.nationalAddress || null,
      },
    });

    const beforeSnap = {
      nameEn: before.nameEn,
      nameAr: before.nameAr,
      crNumber: before.crNumber,
      vatNumber: before.vatNumber,
      website: before.website,
      email: before.email,
      phone: before.phone,
      addressLine1: before.addressLine1,
      addressLine2: before.addressLine2,
      city: before.city,
      region: before.region,
      postalCode: before.postalCode,
      country: before.country,
      nationalAddress: before.nationalAddress,
    };
    const afterSnap = {
      nameEn: after.nameEn,
      nameAr: after.nameAr,
      crNumber: after.crNumber,
      vatNumber: after.vatNumber,
      website: after.website,
      email: after.email,
      phone: after.phone,
      addressLine1: after.addressLine1,
      addressLine2: after.addressLine2,
      city: after.city,
      region: after.region,
      postalCode: after.postalCode,
      country: after.country,
      nationalAddress: after.nationalAddress,
    };

    const updatedFields = diffKeys(beforeSnap, afterSnap, PROFILE_LABELS);
    const { ip, userAgent } = await requestMeta();

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "organisation.update",
      entityType: "Organisation",
      entityId: orgId,
      before: beforeSnap,
      after: afterSnap,
      ip,
      userAgent,
    });

    revalidatePath("/[locale]/client/company", "page");

    return {
      ok: true,
      data: {
        logoUrl: after.logoKey ? storage.publicUrl(after.logoKey) : null,
      },
      updatedFields,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function saveOrganisationLogo(
  formData: FormData,
): Promise<ActionResult<{ logoUrl: string; logoKey: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "company:write");
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "NO_FILE" };
    }

    if (file.size > 2 * 1024 * 1024) {
      return { ok: false, error: "INVALID_LOGO" };
    }

    const { organisationId: orgId } = scopedDb(session);
    const before = await prisma.organisation.findFirst({
      where: { id: orgId, type: "CLIENT" },
      select: { logoKey: true },
    });
    if (!before) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    const logoAllowlist = ["image/png", "image/jpeg"] as const;
    if (!mimeAllowed(sniffed, logoAllowlist)) {
      return { ok: false, error: "INVALID_LOGO" };
    }
    const meta = logoUploadMetaSchema.safeParse({
      mimeType: sniffed,
      sizeBytes: buffer.byteLength,
    });
    if (!meta.success) {
      return { ok: false, error: "INVALID_LOGO" };
    }

    const stored = await storage.put({
      keyPrefix: `orgs/${orgId}/logo`,
      fileName: file.name || "logo.png",
      mimeType: sniffed,
      body: buffer,
    });

    const updated = await prisma.organisation.update({
      where: { id: orgId },
      data: { logoKey: stored.key },
      select: { logoKey: true },
    });

    if (before.logoKey && before.logoKey !== stored.key) {
      await storage.delete(before.logoKey);
    }

    const { ip, userAgent } = await requestMeta();
    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "organisation.logo.update",
      entityType: "Organisation",
      entityId: orgId,
      ip,
      userAgent,
      before: { logoKey: before.logoKey },
      after: { logoKey: updated.logoKey },
    });

    revalidatePath("/[locale]/client/company", "page");

    return {
      ok: true,
      data: {
        logoKey: stored.key,
        logoUrl: storage.publicUrl(stored.key),
      },
      updatedFields: ["logo"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function inviteOrganisationUser(
  input: InviteUserInput,
): Promise<ActionResult<{ userId: string; emailed: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "users:manage");
    const parsed = inviteUserSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "VALIDATION",
        fieldErrors: mapZodError(parsed.error),
      };
    }

    // Only an existing owner may create another owner — CLIENT_ADMIN has
    // "users:manage" too but must not be able to mint owner-level access.
    if (parsed.data.role === "CLIENT_OWNER" && !hasRole(session, "CLIENT_OWNER")) {
      return { ok: false, error: "FORBIDDEN" };
    }

    const { organisationId: orgId } = scopedDb(session);
    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return { ok: false, error: "EMAIL_UNAVAILABLE" };
    }

    // No password is generated or emailed here: the invitee sets their own
    // via the invite-link flow below, so this hash is never usable.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    const usernameBase = parsed.data.email
      .split("@")[0]
      ?.replace(/[^a-zA-Z0-9._-]/g, ".")
      .slice(0, 40);
    const username = `${usernameBase}.${Date.now().toString(36)}`;
    const { ip, userAgent } = await requestMeta();

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organisationId: orgId,
          email: parsed.data.email,
          username,
          passwordHash,
          fullNameEn: parsed.data.fullNameEn,
          fullNameAr: parsed.data.fullNameAr,
          locale: "ar",
          status: "ACTIVE",
          // Stays unverified/unusable for login until the invitee completes
          // the invite link, which sets their password and verifies email.
          roles: { create: [{ role: parsed.data.role }] },
        },
      });

      await writeAuditLog({
        session,
        tx,
        organisationId: orgId,
        action: "user.invite",
        entityType: "User",
        entityId: created.id,
        before: undefined,
        after: {
          email: created.email,
          role: parsed.data.role,
          organisationId: orgId,
        },
        ip,
        userAgent,
      });

      return created;
    });

    // The account and audit trail are already committed above; a failure
    // here only means the invite link needs to be resent, not data loss.
    let emailed = false;
    try {
      const token = await issueVerificationToken(
        user.id,
        "PASSWORD_RESET",
        INVITE_TOKEN_TTL_MS,
      );
      emailed = await sendInviteEmail({
        to: user.email,
        locale: user.locale,
        token,
      });
    } catch {
      emailed = false;
    }

    revalidatePath("/[locale]/client/company", "page");
    return {
      ok: true,
      data: { userId: user.id, emailed },
      updatedFields: ["users"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function changeOrganisationUserRole(
  input: unknown,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "users:manage");
    const parsed = changeUserRoleSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "VALIDATION" };
    }

    const { organisationId: orgId } = scopedDb(session);
    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisationId: orgId },
      include: { roles: true },
    });
    if (!target) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (target.id === session.id && parsed.data.role !== "CLIENT_OWNER") {
      return { ok: false, error: "CANNOT_DEMOTE_SELF" };
    }

    const wasOwner = target.roles.some((r) => r.role === "CLIENT_OWNER");
    // Granting or revoking owner-level access is owner-only — CLIENT_ADMIN
    // must not be able to promote itself/others to owner or demote one.
    if ((wasOwner || parsed.data.role === "CLIENT_OWNER") && !hasRole(session, "CLIENT_OWNER")) {
      return { ok: false, error: "FORBIDDEN" };
    }

    if (wasOwner && parsed.data.role !== "CLIENT_OWNER") {
      const activeOwnerCount = await prisma.user.count({
        where: {
          organisationId: orgId,
          status: "ACTIVE",
          roles: { some: { role: "CLIENT_OWNER" } },
        },
      });
      if (activeOwnerCount <= 1) {
        return { ok: false, error: "LAST_OWNER" };
      }
    }

    const beforeRoles = target.roles.map((r) => r.role);
    const { ip, userAgent } = await requestMeta();
    await prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: target.id } });
      await tx.userRole.create({
        data: { userId: target.id, role: parsed.data.role },
      });
      await writeAuditLog({
        session,
        tx,
        organisationId: orgId,
        action: "user.role.change",
        entityType: "User",
        entityId: target.id,
        before: { roles: beforeRoles },
        after: { roles: [parsed.data.role] },
        ip,
        userAgent,
      });
    });

    revalidatePath("/[locale]/client/company", "page");
    return { ok: true, data: undefined, updatedFields: ["role"] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function deactivateOrganisationUser(
  input: unknown,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "users:manage");
    const parsed = deactivateUserSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "VALIDATION" };
    }
    if (parsed.data.userId === session.id) {
      return { ok: false, error: "CANNOT_DEACTIVATE_SELF" };
    }

    const { organisationId: orgId } = scopedDb(session);
    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisationId: orgId },
      include: { roles: true },
    });
    if (!target) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const targetIsOwner = target.roles.some((r) => r.role === "CLIENT_OWNER");
    // Disabling an owner account is itself owner-level access change —
    // CLIENT_ADMIN must not be able to lock out an owner.
    if (targetIsOwner && !hasRole(session, "CLIENT_OWNER")) {
      return { ok: false, error: "FORBIDDEN" };
    }

    if (targetIsOwner) {
      const activeOwnerCount = await prisma.user.count({
        where: {
          organisationId: orgId,
          status: "ACTIVE",
          roles: { some: { role: "CLIENT_OWNER" } },
        },
      });
      if (activeOwnerCount <= 1) {
        return { ok: false, error: "LAST_OWNER" };
      }
    }

    await prisma.user.update({
      where: { id: target.id },
      data: { status: "DISABLED" },
    });

    const { ip, userAgent } = await requestMeta();
    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "user.deactivate",
      entityType: "User",
      entityId: target.id,
      ip,
      userAgent,
      before: { status: target.status },
      after: { status: "DISABLED" },
    });

    revalidatePath("/[locale]/client/company", "page");
    return { ok: true, data: undefined, updatedFields: ["status"] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function saveUserPreferences(
  input: PreferencesInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "preferences:write");
    const { organisationId: orgId } = scopedDb(session);
    const parsed = preferencesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: "VALIDATION",
        fieldErrors: mapZodError(parsed.error),
      };
    }

    const beforeUser = await prisma.user.findUnique({
      where: { id: session.id },
      select: { locale: true },
    });
    const beforePrefs = await prisma.notificationPreference.findMany({
      where: { userId: session.id },
    });

    const sanitized = parsed.data.notifications.map((pref) => {
      if (isLegalFinancialEvent(pref.eventType)) {
        return {
          ...pref,
          emailEnabled: true,
          inAppEnabled: true,
        };
      }
      return pref;
    });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: session.id },
        data: { locale: parsed.data.locale },
      });
      for (const pref of sanitized) {
        await tx.notificationPreference.upsert({
          where: {
            userId_eventType: {
              userId: session.id,
              eventType: pref.eventType,
            },
          },
          create: {
            userId: session.id,
            eventType: pref.eventType,
            emailEnabled: pref.emailEnabled,
            inAppEnabled: pref.inAppEnabled,
          },
          update: {
            emailEnabled: pref.emailEnabled,
            inAppEnabled: pref.inAppEnabled,
          },
        });
      }
    });

    const { ip, userAgent } = await requestMeta();
    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "user.preferences.update",
      entityType: "User",
      entityId: session.id,
      ip,
      userAgent,
      before: {
        locale: beforeUser?.locale,
        notifications: beforePrefs,
      },
      after: {
        locale: parsed.data.locale,
        notifications: sanitized,
      },
    });

    revalidatePath("/[locale]/client/company", "page");
    return {
      ok: true,
      data: undefined,
      updatedFields: ["locale", "notifications"],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
