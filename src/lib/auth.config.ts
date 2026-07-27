import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";
import { NextResponse } from "next/server";

const LOCALE_PREFIX = /^\/(ar|en)(\/|$)/;

export const authConfig = {
  providers: [],
  // Node jwt callback in auth.ts revalidates against the DB; edge middleware cannot use Prisma.
  session: {
    strategy: "jwt",
    // Deactivated-user check runs on every jwt callback invocation (see auth.ts),
    // so maxAge doesn't gate that anymore — it only controls how long an idle
    // session survives before requiring re-login.
    maxAge: 24 * 60 * 60, // 24 hours
    updateAge: 60 * 60, // refresh (slide) the session at most once per hour of activity
  },
  pages: {
    // Auth.js fallback when no request locale is available (edge/default).
    // Locale-aware redirects are handled in `authorized` below.
    signIn: "/ar/login",
  },
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const isProtected =
        /\/(client|admin)(\/|$)/.test(pathname) && !pathname.includes("/api/");
      if (!isProtected) return true;

      const localeMatch = pathname.match(LOCALE_PREFIX);
      const locale = localeMatch?.[1] ?? "ar";

      if (!auth?.user) {
        const signInUrl = request.nextUrl.clone();
        signInUrl.pathname = `/${locale}/login`;
        signInUrl.searchParams.set("callbackUrl", request.nextUrl.href);
        return NextResponse.redirect(signInUrl);
      }

      const orgType = auth.user.orgType;
      const isAdminPath = /\/admin(\/|$)/.test(pathname);
      const isClientPath = /\/client(\/|$)/.test(pathname);

      if (isAdminPath && orgType !== "ATLAS") {
        const url = request.nextUrl.clone();
        url.pathname = `/${locale}/client`;
        url.search = "";
        return NextResponse.redirect(url);
      }
      if (isClientPath && orgType !== "CLIENT") {
        const url = request.nextUrl.clone();
        url.pathname = `/${locale}/admin`;
        url.search = "";
        return NextResponse.redirect(url);
      }

      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        token.organisationId = user.organisationId;
        token.roles = user.roles;
        token.fullNameEn = user.fullNameEn;
        token.fullNameAr = user.fullNameAr;
        token.orgType = user.orgType;
        token.orgNameEn = user.orgNameEn;
        token.orgNameAr = user.orgNameAr;
        token.orgLogoKey = user.orgLogoKey;
        token.locale = user.locale;
      }
      return token;
    },
    session({ session, token }) {
      if (!token?.id) {
        return session;
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.organisationId = token.organisationId as string;
        session.user.roles = (token.roles as Role[]) ?? [];
        session.user.fullNameEn = token.fullNameEn as string;
        session.user.fullNameAr = token.fullNameAr as string;
        session.user.orgType = token.orgType as "CLIENT" | "ATLAS";
        session.user.orgNameEn = token.orgNameEn as string;
        session.user.orgNameAr = token.orgNameAr as string;
        session.user.orgLogoKey = (token.orgLogoKey as string | null) ?? null;
        session.user.locale = (token.locale as string) ?? "ar";
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
