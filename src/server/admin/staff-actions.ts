"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { sendInviteEmail } from "@/lib/auth/auth-email";
import { requireSession } from "@/lib/auth/session";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import {
  createClientSchema,
  deactivateAtlasStaffSchema,
  inviteAtlasStaffSchema,
  updateAtlasStaffRoleSchema,
  type CreateClientInput,
  type DeactivateAtlasStaffInput,
  type InviteAtlasStaffInput,
  type UpdateAtlasStaffRoleInput,
} from "@/lib/validators/admin";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Atlas organisation settings, staff invite/role/deactivate, and client
 * account creation (on-behalf). Split out of the former admin/actions.ts —
 * see workflow-actions.ts for the request-lifecycle actions this used to
 * share a file with.
 */
const updateAtlasOrgSchema = z.object({
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  email: z.email(),
  phone: z.string().trim().max(30).nullable().optional(),
});

export async function updateAtlasOrganisation(
  input: z.infer<typeof updateAtlasOrgSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");
    const parsed = updateAtlasOrgSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const atlas = await prisma.organisation.findFirst({
      where: { type: "ATLAS" },
    });
    if (!atlas) return { ok: false, error: "NOT_FOUND" };

    const before = {
      nameEn: atlas.nameEn,
      nameAr: atlas.nameAr,
      email: atlas.email,
      phone: atlas.phone,
    };

    await prisma.organisation.update({
      where: { id: atlas.id },
      data: {
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
      },
    });

    await writeAuditLog({
      session,
      action: "organisation.atlas.update",
      entityType: "Organisation",
      entityId: atlas.id,
      before,
      after: parsed.data,
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const STAFF_INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function inviteAtlasStaff(
  input: InviteAtlasStaffInput,
): Promise<ActionResult<{ userId: string; emailed: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = inviteAtlasStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) return { ok: false, error: "EMAIL_UNAVAILABLE" };

    const atlasOrgId =
      session.organisation.type === "ATLAS"
        ? session.organisationId
        : (await prisma.organisation.findFirst({ where: { type: "ATLAS" } }))
            ?.id;
    if (!atlasOrgId) return { ok: false, error: "NOT_FOUND" };

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
          organisationId: atlasOrgId,
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
        action: "staff.invite",
        entityType: "User",
        entityId: created.id,
        ip,
        userAgent,
        after: {
          email: created.email,
          role: parsed.data.role,
          organisationId: atlasOrgId,
        },
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
        STAFF_INVITE_TOKEN_TTL_MS,
      );
      emailed = await sendInviteEmail({
        to: user.email,
        locale: user.locale,
        token,
      });
    } catch {
      emailed = false;
    }

    revalidatePath("/[locale]/admin/settings", "page");
    return {
      ok: true,
      data: { userId: user.id, emailed },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function updateAtlasStaffRole(
  input: UpdateAtlasStaffRoleInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = updateAtlasStaffRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisation: { type: "ATLAS" } },
      include: { roles: true },
    });
    if (!target) return { ok: false, error: "NOT_FOUND" };

    const wasAdmin = target.roles.some((r) => r.role === "SYSTEM_ADMIN");
    if (wasAdmin && parsed.data.role !== "SYSTEM_ADMIN") {
      const activeAdminCount = await prisma.user.count({
        where: {
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "SYSTEM_ADMIN" } },
        },
      });
      if (activeAdminCount <= 1) {
        return { ok: false, error: "LAST_ADMIN" };
      }
    }

    const beforeRoles = target.roles.map((r) => r.role);
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: target.id } }),
      prisma.userRole.create({
        data: { userId: target.id, role: parsed.data.role },
      }),
    ]);

    await writeAuditLog({
      session,
      action: "staff.role.change",
      entityType: "User",
      entityId: target.id,
      before: { roles: beforeRoles },
      after: { roles: [parsed.data.role] },
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function deactivateAtlasStaff(
  input: DeactivateAtlasStaffInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = deactivateAtlasStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    if (parsed.data.userId === session.id) {
      return { ok: false, error: "CANNOT_DEACTIVATE_SELF" };
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisation: { type: "ATLAS" } },
      include: { roles: true },
    });
    if (!target) return { ok: false, error: "NOT_FOUND" };

    if (target.roles.some((r) => r.role === "SYSTEM_ADMIN")) {
      const activeAdminCount = await prisma.user.count({
        where: {
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "SYSTEM_ADMIN" } },
        },
      });
      if (activeAdminCount <= 1) {
        return { ok: false, error: "LAST_ADMIN" };
      }
    }

    await prisma.user.update({
      where: { id: target.id },
      data: { status: "DISABLED" },
    });

    await writeAuditLog({
      session,
      action: "staff.deactivate",
      entityType: "User",
      entityId: target.id,
      before: { status: target.status },
      after: { status: "DISABLED" },
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

/** Derive a unique, URL-safe username from the email local part. */
async function uniqueClientUsername(email: string): Promise<string> {
  const base =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9._-]/g, "")
      .slice(0, 24) || "user";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Admin-side client onboarding: creates a client organisation and its owner
 * user in one transaction. The account is ACTIVE with the email pre-verified,
 * so the owner can sign in immediately with the initial password the admin set.
 */
export async function createClientAction(
  input: CreateClientInput,
): Promise<ActionResult<{ organisationId: string; email: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "clients:create");

    const parsed = createClientSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const known = ["INVALID_SAUDI_PHONE", "WEAK_PASSWORD"];
      const code =
        issue && known.includes(issue.message) ? issue.message : "VALIDATION";
      return { ok: false, error: code };
    }

    const data = parsed.data;
    const email = data.email.toLowerCase();
    const phone = data.phone ? data.phone.trim() || null : null;

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return { ok: false, error: "EMAIL_TAKEN" };

    const username = await uniqueClientUsername(email);
    const passwordHash = await bcrypt.hash(data.password, 12);

    let organisationId: string;
    try {
      organisationId = await prisma.$transaction(async (tx) => {
        const organisation = await tx.organisation.create({
          data: {
            type: "CLIENT",
            clientCategory: "COMPANY",
            nameEn: data.companyNameEn,
            nameAr: data.companyNameAr,
            email,
            phone,
            status: "ACTIVE",
          },
        });

        const user = await tx.user.create({
          data: {
            organisationId: organisation.id,
            email,
            username,
            passwordHash,
            fullNameEn: data.fullNameEn,
            fullNameAr: data.fullNameAr,
            phone,
            locale: data.locale,
            status: "ACTIVE",
            // Admin-created accounts are trusted: verified so login is allowed.
            emailVerifiedAt: new Date(),
            roles: { create: [{ role: "CLIENT_OWNER" }] },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            organisationId: organisation.id,
            action: "admin.client.create",
            entityType: "Organisation",
            entityId: organisation.id,
            after: {
              organisationNameEn: organisation.nameEn,
              ownerEmail: email,
              ownerUserId: user.id,
            },
          },
        });

        return organisation.id;
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: string }).code)
          : "";
      if (code === "P2002") return { ok: false, error: "EMAIL_TAKEN" };
      return { ok: false, error: "SAVE_FAILED" };
    }

    revalidatePath("/[locale]/admin/clients", "page");
    return { ok: true, data: { organisationId, email } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
