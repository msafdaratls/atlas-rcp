"use server";

import { prisma } from "@/lib/db";
import { consumeVerificationToken } from "@/lib/auth/tokens";

export type VerifyEmailResult =
  | { ok: true }
  | { ok: false; error: "INVALID_TOKEN" };

/**
 * Confirms an email-verification token: marks the user's email verified and
 * clears any lockout. Idempotent-ish — a used/expired token returns INVALID.
 */
export async function verifyEmailAction(
  token: string,
): Promise<VerifyEmailResult> {
  const raw = (token ?? "").trim();
  if (!raw) return { ok: false, error: "INVALID_TOKEN" };

  const userId = await consumeVerificationToken(raw, "EMAIL_VERIFICATION");
  if (!userId) return { ok: false, error: "INVALID_TOKEN" };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organisationId: true, emailVerifiedAt: true },
  });
  if (!user) return { ok: false, error: "INVALID_TOKEN" };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: "CLIENT_OWNER",
        organisationId: user.organisationId,
        action: "auth.email.verify",
        entityType: "User",
        entityId: userId,
        after: { emailVerified: true },
      },
    });
  });

  return { ok: true };
}
