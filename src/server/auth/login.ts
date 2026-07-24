"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginActionResult =
  | { ok: true; redirectTo: "/client" | "/admin" }
  | { ok: false; error: string; email?: string };

export async function loginAction(
  formData: FormData,
): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: "INVALID_CREDENTIALS" };
  }

  const email = parsed.data.email.toLowerCase();
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipOrEmail = forwarded || email;
  const limited = await consumeRateLimitAsync({
    key: `login:${ipOrEmail}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  // Pre-check for clearer messaging (enforcement also lives in authorize()).
  const known = await prisma.user.findUnique({
    where: { email },
    select: { emailVerifiedAt: true, lockedUntil: true, status: true },
  });
  if (known && known.status === "ACTIVE") {
    if (known.lockedUntil && known.lockedUntil.getTime() > Date.now()) {
      return { ok: false, error: "ACCOUNT_LOCKED" };
    }
    if (!known.emailVerifiedAt) {
      return { ok: false, error: "EMAIL_NOT_VERIFIED", email };
    }
  }

  try {
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });

    const session = await getSession();
    if (!session) {
      return { ok: false, error: "INVALID_CREDENTIALS" };
    }

    return {
      ok: true,
      redirectTo: session.organisation.type === "ATLAS" ? "/admin" : "/client",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: "INVALID_CREDENTIALS" };
    }
    throw error;
  }
}
