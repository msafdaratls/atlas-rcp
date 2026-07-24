import NextAuth from "next-auth";
import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";

import { authConfig } from "@/lib/auth.config";
import { defaultLocale, locales } from "@/lib/i18n/config";

const { auth } = NextAuth(authConfig);
const intlMiddleware = createMiddleware({
  locales: [...locales],
  defaultLocale,
  localePrefix: "always",
});

export default auth((request) => {
  return intlMiddleware(request as unknown as NextRequest);
});

export const config = {
  matcher: ["/", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
