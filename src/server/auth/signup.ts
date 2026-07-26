"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { sendVerificationEmail } from "@/lib/auth/auth-email";
import { signupSchema } from "@/lib/validators/auth";

export type SignupActionResult =
  | { ok: true; requiresVerification: true; email: string }
  | { ok: false; error: string };

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Derive a unique, URL-safe username from the email local part. */
async function uniqueUsername(email: string): Promise<string> {
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
  // Extremely unlikely fallback — guaranteed unique enough for practical use.
  return `${base}-${Date.now().toString(36)}`;
}

export async function signupAction(
  formData: FormData,
): Promise<SignupActionResult> {
  const parsed = signupSchema.safeParse({
    companyNameEn: formData.get("companyNameEn"),
    companyNameAr: formData.get("companyNameAr"),
    fullNameEn: formData.get("fullNameEn"),
    fullNameAr: formData.get("fullNameAr"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    locale: formData.get("locale") || "ar",
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const known = ["PASSWORD_MISMATCH", "INVALID_SAUDI_PHONE", "WEAK_PASSWORD"];
    const code =
      issue && known.includes(issue.message) ? issue.message : "VALIDATION";
    return { ok: false, error: code };
  }

  const data = parsed.data;
  const email = data.email.toLowerCase();
  const phone = data.phone.trim();

  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const limited = await consumeRateLimitAsync({
    key: `signup:${forwarded || email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  let verificationToken: string | null = null;

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      return { ok: false, error: "EMAIL_TAKEN" };
    }

    const username = await uniqueUsername(email);
    const passwordHash = await hash(data.password, 12);

    verificationToken = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          type: "CLIENT",
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
          // Left unverified — login is blocked until the email is confirmed.
          emailVerifiedAt: null,
          roles: { create: [{ role: "CLIENT_OWNER" }] },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          actorRole: "CLIENT_OWNER",
          organisationId: organisation.id,
          action: "auth.signup",
          entityType: "Organisation",
          entityId: organisation.id,
          after: {
            organisationNameEn: organisation.nameEn,
            userEmail: email,
          },
        },
      });

      return issueVerificationToken(
        user.id,
        "EMAIL_VERIFICATION",
        VERIFICATION_TTL_MS,
        tx,
      );
    });
  } catch (error) {
    // Unique-constraint race on email/username → treat as taken.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "";
    if (code === "P2002") {
      return { ok: false, error: "EMAIL_TAKEN" };
    }
    return { ok: false, error: "SIGNUP_FAILED" };
  }

  await sendVerificationEmail({ to: email, locale: data.locale, token: verificationToken });

  return { ok: true, requiresVerification: true, email };
}

/** Re-sends a verification link. Always reports success (no account enumeration). */
export async function resendVerificationAction(
  formData: FormData,
): Promise<{ ok: true }> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const locale = formData.get("locale") === "en" ? "en" : "ar";
  if (!email) return { ok: true };

  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const limited = await consumeRateLimitAsync({
    key: `resend-verify:${forwarded || email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) return { ok: true };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailVerifiedAt: true, locale: true },
  });
  if (user && !user.emailVerifiedAt) {
    const token = await issueVerificationToken(
      user.id,
      "EMAIL_VERIFICATION",
      VERIFICATION_TTL_MS,
    );
    await sendVerificationEmail({ to: email, locale: user.locale || locale, token });
  }
  return { ok: true };
}
