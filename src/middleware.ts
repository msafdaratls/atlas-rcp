import NextAuth from "next-auth";
import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { authConfig } from "@/lib/auth.config";
import { defaultLocale, locales } from "@/lib/i18n/config";
import { buildCsp } from "@/lib/security/csp";

const { auth } = NextAuth(authConfig);
const intlMiddleware = createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});

export default auth((request) => {
  const response = intlMiddleware(request as unknown as NextRequest);
  response.headers.set("Content-Security-Policy", buildCsp());
  return response;
});

export const config = {
  matcher: ["/", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
