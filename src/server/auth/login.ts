"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";
import type { Role } from "@prisma/client";

import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";

async function logAuthEvent(input: {
  userId: string;
  organisationId: string;
  actorRole: Role | null;
  action: string;
  ip?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.userId,
      actorRole: input.actorRole ?? undefined,
      organisationId: input.organisationId,
      action: input.action,
      entityType: "User",
      entityId: input.userId,
      ip: input.ip,
    },
  });
}

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
    select: {
      id: true,
      organisationId: true,
      emailVerifiedAt: true,
      lockedUntil: true,
      status: true,
      roles: { select: { role: true }, take: 1 },
    },
  });
  if (known && known.status === "ACTIVE") {
    if (known.lockedUntil && known.lockedUntil.getTime() > Date.now()) {
      await logAuthEvent({
        userId: known.id,
        organisationId: known.organisationId,
        actorRole: known.roles[0]?.role ?? null,
        action: "auth.login.blocked_locked",
        ip: forwarded,
      });
      return { ok: false, error: "ACCOUNT_LOCKED" };
    }
    if (!known.emailVerifiedAt) {
      return { ok: false, error: "EMAIL_NOT_VERIFIED", email };
    }
  }

  try {
    // signIn sets the session cookie on the *response*; it throws AuthError on
    // bad credentials and returns cleanly on success. We must NOT read the
    // session back via auth()/getSession() here — that reads the *incoming*
    // request's cookies, which don't yet carry the cookie signIn just set, so
    // the first attempt would spuriously fail ("wrong password") and only the
    // second (which now has the cookie) would succeed.
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });

    // Login succeeded (no throw). Decide the redirect from the DB rather than
    // from a session we can't yet observe in this request.
    const org = await prisma.user.findUnique({
      where: { email },
      select: { organisation: { select: { type: true } } },
    });

    if (known) {
      await logAuthEvent({
        userId: known.id,
        organisationId: known.organisationId,
        actorRole: known.roles[0]?.role ?? null,
        action: "auth.login.success",
        ip: forwarded,
      });
    }

    return {
      ok: true,
      redirectTo: org?.organisation.type === "ATLAS" ? "/admin" : "/client",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      if (known) {
        await logAuthEvent({
          userId: known.id,
          organisationId: known.organisationId,
          actorRole: known.roles[0]?.role ?? null,
          action: "auth.login.failed",
          ip: forwarded,
        });
      }
      return { ok: false, error: "INVALID_CREDENTIALS" };
    }
    throw error;
  }
}
