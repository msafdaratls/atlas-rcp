"use server";

import { headers } from "next/headers";
import { hash } from "bcryptjs";

import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";
import { issueVerificationToken } from "@/lib/auth/tokens";
import { sendVerificationEmail } from "@/lib/auth/auth-email";
import { composeSignupPhone, signupSchema } from "@/lib/validators/auth";

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
    accountType: formData.get("accountType") || "COMPANY",
    isInternational: formData.get("isInternational") === "true",
    companyNameEn: formData.get("companyNameEn") || "",
    companyNameAr: formData.get("companyNameAr") || "",
    crNumber: formData.get("crNumber") || "",
    vatNumber: formData.get("vatNumber") || "",
    nationalAddress: formData.get("nationalAddress") || "",
    fullNameEn: formData.get("fullNameEn"),
    fullNameAr: formData.get("fullNameAr"),
    email: formData.get("email"),
    phoneCountry: formData.get("phoneCountry"),
    phoneNumber: formData.get("phoneNumber"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    locale: formData.get("locale") || "ar",
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const known = [
      "PASSWORD_MISMATCH",
      "INVALID_PHONE",
      "WEAK_PASSWORD",
      "REQUIRED",
      "INVALID_VAT",
      "INVALID_NATIONAL_ADDRESS",
    ];
    const code =
      issue && known.includes(issue.message) ? issue.message : "VALIDATION";
    return { ok: false, error: code };
  }

  const data = parsed.data;
  const email = data.email.toLowerCase();
  const phone = composeSignupPhone(data);
  const isCompany = data.accountType === "COMPANY";
  const crNumber = isCompany && !data.isInternational ? data.crNumber.trim() : null;
  const vatNumber = isCompany && !data.isInternational ? data.vatNumber.trim() : null;
  const nationalAddress =
    isCompany && !data.isInternational ? data.nationalAddress.trim() : null;
  const nameEn = isCompany ? data.companyNameEn.trim() : data.fullNameEn.trim();
  const nameAr = isCompany ? data.companyNameAr.trim() : data.fullNameAr.trim();

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
    const existingEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingEmail) {
      return { ok: false, error: "EMAIL_TAKEN" };
    }

    if (!isCompany) {
      const existingPhone = await prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (existingPhone) {
        return { ok: false, error: "PHONE_TAKEN" };
      }
    } else if (!data.isInternational && crNumber) {
      const existingCr = await prisma.organisation.findUnique({
        where: { crNumber },
        select: { id: true },
      });
      if (existingCr) {
        return { ok: false, error: "CR_TAKEN" };
      }
    }

    const username = await uniqueUsername(email);
    const passwordHash = await hash(data.password, 12);

    verificationToken = await prisma.$transaction(async (tx) => {
      const organisation = await tx.organisation.create({
        data: {
          type: "CLIENT",
          clientCategory: isCompany ? "COMPANY" : "INDIVIDUAL",
          isInternational: isCompany ? data.isInternational : false,
          nameEn,
          nameAr,
          email,
          phone,
          crNumber,
          vatNumber,
          nationalAddress,
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
    // Unique-constraint race on email/username/phone/crNumber → map to the right code.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: string }).code)
        : "";
    if (code === "P2002") {
      const target =
        error &&
        typeof error === "object" &&
        "meta" in error &&
        error.meta &&
        typeof error.meta === "object" &&
        "target" in error.meta
          ? (error.meta as { target?: unknown }).target
          : undefined;
      const fields = Array.isArray(target) ? target.map(String) : [];
      if (fields.includes("crNumber")) return { ok: false, error: "CR_TAKEN" };
      if (fields.includes("phone")) return { ok: false, error: "PHONE_TAKEN" };
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
