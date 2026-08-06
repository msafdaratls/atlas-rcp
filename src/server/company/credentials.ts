"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { writeAuditLog, requestMeta } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { scopedDb } from "@/lib/scoped-db";
import { resolveRequestContext } from "@/lib/request-context";
import { decryptSecret, encryptSecret } from "@/lib/crypto/vault";
import {
  createCredentialSchema,
  deactivateCredentialSchema,
} from "@/lib/validators/company";
import type { ActionResult } from "@/server/company/actions";

export type PlatformCredentialSummary = {
  id: string;
  platform: "GHAD" | "SABER" | "FASAH";
  label: string | null;
  loginIdentifier: string;
  active: boolean;
  createdAt: Date;
};

/**
 * List of the acting organisation's stored credentials — never the secret,
 * only what's needed to pick one. Uses resolveRequestContext (not the raw
 * session) so an Atlas staff member acting on behalf of a client sees that
 * client's credentials, not their own ATLAS org's.
 */
export async function listOrganisationCredentials(): Promise<
  PlatformCredentialSummary[]
> {
  const ctx = await resolveRequestContext();

  return prisma.platformCredential.findMany({
    where: { organisationId: ctx.organisationId, active: true },
    select: {
      id: true,
      platform: true,
      label: true,
      loginIdentifier: true,
      active: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createCredential(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "credentials:manage");
    const { organisationId } = scopedDb(session);

    const parsed = createCredentialSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "VALIDATION" };
    }

    const encrypted = encryptSecret(parsed.data.secret);
    const meta = await requestMeta();

    const created = await prisma.$transaction(async (tx) => {
      const credential = await tx.platformCredential.create({
        data: {
          organisationId,
          platform: parsed.data.platform,
          label: parsed.data.label || null,
          loginIdentifier: parsed.data.loginIdentifier,
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretAuthTag: encrypted.authTag,
          createdByUserId: session.id,
        },
      });

      await writeAuditLog({
        session,
        action: "credentials.create",
        entityType: "PlatformCredential",
        entityId: credential.id,
        organisationId,
        // Never write the secret itself to the audit log.
        after: {
          platform: credential.platform,
          loginIdentifier: credential.loginIdentifier,
          label: credential.label,
        },
        tx,
        ...meta,
      });

      return credential;
    });

    revalidatePath("/[locale]/client/company", "page");
    return { ok: true, data: { id: created.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "FAILED" };
  }
}

export async function deactivateCredential(
  input: unknown,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "credentials:manage");
    const { organisationId } = scopedDb(session);

    const parsed = deactivateCredentialSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "VALIDATION" };
    }

    const credential = await prisma.platformCredential.findFirst({
      where: { id: parsed.data.credentialId, organisationId },
      select: { id: true },
    });
    if (!credential) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const meta = await requestMeta();
    await prisma.$transaction(async (tx) => {
      await tx.platformCredential.update({
        where: { id: credential.id },
        data: { active: false },
      });
      await writeAuditLog({
        session,
        action: "credentials.deactivate",
        entityType: "PlatformCredential",
        entityId: credential.id,
        organisationId,
        tx,
        ...meta,
      });
    });

    revalidatePath("/[locale]/client/company", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "FAILED" };
  }
}

/**
 * Staff-only: decrypts a credential's plaintext so it can be used to log
 * into the client's actual GHAD/SABER/FASAH account. Every call is
 * audit-logged — this is the action the on-behalf-of audit trail exists for.
 */
export async function revealCredential(
  credentialId: string,
): Promise<ActionResult<{ loginIdentifier: string; secret: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "credentials:reveal");

    const credential = await prisma.platformCredential.findUnique({
      where: { id: credentialId },
      select: {
        id: true,
        organisationId: true,
        loginIdentifier: true,
        secretCiphertext: true,
        secretIv: true,
        secretAuthTag: true,
        active: true,
      },
    });
    if (!credential || !credential.active) {
      return { ok: false, error: "NOT_FOUND" };
    }

    const secret = decryptSecret({
      ciphertext: credential.secretCiphertext,
      iv: credential.secretIv,
      authTag: credential.secretAuthTag,
    });

    const meta = await requestMeta();
    await writeAuditLog({
      session,
      action: "credentials.reveal",
      entityType: "PlatformCredential",
      entityId: credential.id,
      organisationId: credential.organisationId,
      ...meta,
    });

    return {
      ok: true,
      data: { loginIdentifier: credential.loginIdentifier, secret },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "FAILED" };
  }
}
