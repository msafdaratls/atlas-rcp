"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { hash } from "bcryptjs";

import { signIn } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import { signupSchema } from "@/lib/validators/auth";

export type SignupActionResult =
  | { ok: true; redirectTo: "/client" }
  | { ok: false; error: string };

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
    phone: formData.get("phone") || null,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
    locale: formData.get("locale") || "ar",
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const code =
      issue?.message === "PASSWORD_MISMATCH" ||
      issue?.message === "INVALID_SAUDI_PHONE"
        ? issue.message
        : "VALIDATION";
    return { ok: false, error: code };
  }

  const data = parsed.data;
  const email = data.email.toLowerCase();
  const phone = data.phone ? data.phone.trim() : null;

  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const limited = consumeRateLimit({
    key: `signup:${forwarded || email}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.ok) {
    return { ok: false, error: "RATE_LIMITED" };
  }

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

    await prisma.$transaction(async (tx) => {
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

  // Sign the new owner in immediately.
  try {
    await signIn("credentials", {
      email,
      password: data.password,
      redirect: false,
    });
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "SIGNUP_FAILED" };
    }
    return { ok: true, redirectTo: "/client" };
  } catch (error) {
    if (error instanceof AuthError) {
      // Account exists but auto sign-in failed — let them sign in manually.
      return { ok: false, error: "SIGNUP_FAILED" };
    }
    throw error;
  }
}
