import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { JWT } from "next-auth/jwt";
import { compare } from "bcryptjs";
import { z } from "zod";

import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/** Account lockout: lock for LOCKOUT_MS after MAX_FAILED_LOGINS bad passwords. */
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function applyUserToToken(
  token: JWT,
  user: {
    id: string;
    organisationId: string;
    roles: JWT["roles"];
    fullNameEn: string;
    fullNameAr: string;
    orgType: JWT["orgType"];
    orgNameEn: string;
    orgNameAr: string;
    orgLogoKey: string | null;
    locale: string;
    email?: string | null;
  },
): JWT {
  token.id = user.id;
  token.organisationId = user.organisationId;
  token.roles = user.roles;
  token.fullNameEn = user.fullNameEn;
  token.fullNameAr = user.fullNameAr;
  token.orgType = user.orgType;
  token.orgNameEn = user.orgNameEn;
  token.orgNameAr = user.orgNameAr;
  token.orgLogoKey = user.orgLogoKey;
  token.locale = user.locale;
  if (user.email) {
    token.email = user.email;
  }
  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: {
            roles: true,
            organisation: {
              select: {
                id: true,
                nameEn: true,
                nameAr: true,
                logoKey: true,
                type: true,
                status: true,
              },
            },
          },
        });

        if (!user || user.status !== "ACTIVE") {
          return null;
        }

        if (user.organisation.status !== "ACTIVE") {
          return null;
        }

        // Locked out after too many failed attempts.
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          return null;
        }

        // Email must be verified before the account can sign in.
        if (!user.emailVerifiedAt) {
          return null;
        }

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) {
          const attempts = user.failedLoginAttempts + 1;
          const locked = attempts >= MAX_FAILED_LOGINS;
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: locked ? 0 : attempts,
              lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MS) : null,
            },
          });
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });

        return {
          id: user.id,
          email: user.email,
          organisationId: user.organisationId,
          roles: user.roles.map((r) => r.role),
          fullNameEn: user.fullNameEn,
          fullNameAr: user.fullNameAr,
          orgType: user.organisation.type,
          orgNameEn: user.organisation.nameEn,
          orgNameAr: user.organisation.nameAr,
          orgLogoKey: user.organisation.logoKey,
          locale: user.locale,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Re-fetch user from DB on every JWT evaluation (privileged correctness).
     * Returning `null` clears the session cookie (Auth.js v5).
     */
    async jwt({ token, user }) {
      if (user) {
        return applyUserToToken(token, {
          id: user.id!,
          organisationId: user.organisationId,
          roles: user.roles,
          fullNameEn: user.fullNameEn,
          fullNameAr: user.fullNameAr,
          orgType: user.orgType,
          orgNameEn: user.orgNameEn,
          orgNameAr: user.orgNameAr,
          orgLogoKey: user.orgLogoKey,
          locale: user.locale,
          email: user.email,
        });
      }

      const userId = typeof token.id === "string" ? token.id : undefined;
      if (!userId) {
        return null;
      }

      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: true,
          organisation: {
            select: {
              id: true,
              nameEn: true,
              nameAr: true,
              logoKey: true,
              type: true,
              status: true,
            },
          },
        },
      });

      if (
        !dbUser ||
        dbUser.status !== "ACTIVE" ||
        dbUser.organisation.status !== "ACTIVE"
      ) {
        return null;
      }

      return applyUserToToken(token, {
        id: dbUser.id,
        email: dbUser.email,
        organisationId: dbUser.organisationId,
        roles: dbUser.roles.map((r) => r.role),
        fullNameEn: dbUser.fullNameEn,
        fullNameAr: dbUser.fullNameAr,
        orgType: dbUser.organisation.type,
        orgNameEn: dbUser.organisation.nameEn,
        orgNameAr: dbUser.organisation.nameAr,
        orgLogoKey: dbUser.organisation.logoKey,
        locale: dbUser.locale,
      });
    },
  },
});
