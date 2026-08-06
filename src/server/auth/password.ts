"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";
import {
  consumeVerificationToken,
  issueVerificationToken,
} from "@/lib/auth/tokens";
import { sendPasswordResetEmail } from "@/lib/auth/auth-email";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validators/auth";

const RESET_TTL_MS = 60 * 60 * 1000;

async function clientIp(): Promise<string | undefined> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

/**
 * Starts a password reset. Always reports success regardless of whether the
 * email exists — never reveals which addresses have accounts.
 */
export async function requestPasswordResetAction(
  formData: FormData,
): Promise<{ ok: true }> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
    locale: formData.get("locale") || "ar",
  });
  if (!parsed.success) return { ok: true };

  const email = parsed.data.email.toLowerCase();
  const limited = await consumeRateLimitAsync({
    key: `pwreset:${(await clientIp()) || email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return { ok: true };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, organisationId: true, status: true, locale: true },
  });
  if (user && user.status === "ACTIVE") {
    const token = await issueVerificationToken(
      user.id,
      "PASSWORD_RESET",
      RESET_TTL_MS,
    );
    await sendPasswordResetEmail({
      to: email,
      locale: user.locale || parsed.data.locale,
      token,
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        organisationId: user.organisationId,
        action: "auth.password.reset_requested",
        entityType: "User",
        entityId: user.id,
        ip: await clientIp(),
      },
    });
  }

  return { ok: true };
}

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string };

/** Completes a reset: validates the token + password policy, sets the hash. */
export async function resetPasswordAction(
  formData: FormData,
): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const known = ["PASSWORD_MISMATCH", "WEAK_PASSWORD"];
    return {
      ok: false,
      error: issue && known.includes(issue.message) ? issue.message : "VALIDATION",
    };
  }

  const limited = await consumeRateLimitAsync({
    key: `pwreset-submit:${(await clientIp()) || "anon"}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return { ok: false, error: "RATE_LIMITED" };

  const userId = await consumeVerificationToken(
    parsed.data.token,
    "PASSWORD_RESET",
  );
  if (!userId) return { ok: false, error: "INVALID_TOKEN" };

  const passwordHash = await hash(parsed.data.password, 12);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { organisationId: true },
  });
  if (!user) return { ok: false, error: "INVALID_TOKEN" };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        // A successful reset also clears any lockout and re-verifies the email
        // (the reset link proved control of the inbox).
        failedLoginAttempts: 0,
        lockedUntil: null,
        emailVerifiedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        actorRole: "CLIENT_OWNER",
        organisationId: user.organisationId,
        action: "auth.password.reset",
        entityType: "User",
        entityId: userId,
        after: { reset: true },
      },
    });
  });

  return { ok: true };
}
