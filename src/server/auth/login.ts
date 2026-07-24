"use server";

import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { z } from "zod";

import { signIn } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type LoginActionResult =
  | { ok: true; redirectTo: "/client" | "/admin" }
  | { ok: false };

export async function loginAction(
  formData: FormData,
): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false };
  }

  const email = parsed.data.email.toLowerCase();
  const hdrs = await headers();
  const forwarded = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipOrEmail = forwarded || email;
  const limited = consumeRateLimit({
    key: `login:${ipOrEmail}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limited.ok) {
    return { ok: false };
  }

  try {
    await signIn("credentials", {
      email,
      password: parsed.data.password,
      redirect: false,
    });

    const session = await getSession();
    if (!session) {
      return { ok: false };
    }

    return {
      ok: true,
      redirectTo:
        session.organisation.type === "ATLAS" ? "/admin" : "/client",
    };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false };
    }
    throw error;
  }
}
