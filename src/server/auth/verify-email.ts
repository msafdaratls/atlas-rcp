"use server";

import { prisma } from "@/lib/db";
import {
  consumeVerificationToken,
  getVerificationTokenOwner,
} from "@/lib/auth/tokens";

export type VerifyEmailResult =
  | { ok: true }
  | { ok: false; error: "INVALID_TOKEN" };

/**
 * Confirms an email-verification token: marks the user's email verified and
 * clears any lockout.
 *
 * Truly idempotent: verification links get prefetched by corporate email
 * "safe links" scanners before the user ever clicks, which would otherwise
 * burn the single-use token and show the real click an error. If the token
 * was already consumed but its owner is already verified, that earlier
 * request was the scanner (or a duplicate click) completing the same
 * verification, so we report success instead of INVALID_TOKEN.
 */
export async function verifyEmailAction(
  token: string,
): Promise<VerifyEmailResult> {
  const raw = (token ?? "").trim();
  if (!raw) return { ok: false, error: "INVALID_TOKEN" };

  const userId = await consumeVerificationToken(raw, "EMAIL_VERIFICATION");
  if (!userId) {
    const owner = await getVerificationTokenOwner(raw, "EMAIL_VERIFICATION");
    if (!owner) return { ok: false, error: "INVALID_TOKEN" };
    const alreadyVerified = await prisma.user.findUnique({
      where: { id: owner },
      select: { emailVerifiedAt: true },
    });
    if (!alreadyVerified?.emailVerifiedAt) {
      return { ok: false, error: "INVALID_TOKEN" };
    }
    return { ok: true };
  }

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
