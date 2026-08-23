import NextAuth from "next-auth";
import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";

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
  // Generated per-request (not in next.config.ts headers()) so script-src
  // can carry a nonce instead of 'unsafe-inline'. Forwarded as a request
  // header too so a Server Component could read it via headers() if it ever
  // needs to nonce a manually-authored inline script — none do today; Next's
  // own hydration scripts pick the nonce up automatically from the CSP
  // response header.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const requestWithNonce = new NextRequest(request, {
    headers: requestHeaders,
  });

  const response = intlMiddleware(requestWithNonce);
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: ["/", "/(ar|en)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
