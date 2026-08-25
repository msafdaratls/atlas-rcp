import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

/**
 * Static security headers applied to every response. HSTS only takes effect
 * over HTTPS (behind the reverse proxy), so it is safe to send in all
 * environments. Content-Security-Policy is NOT here: it needs a per-request
 * nonce for script-src, so it's generated in src/middleware.ts instead (see
 * src/lib/security/csp.ts).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for a small production Docker image.
  output: "standalone",
  serverExternalPackages: [
    "nodemailer",
    "node-cron",
    "@prisma/client",
    "bcryptjs",
    "playwright",
  ],
  experimental: {
    serverActions: {
      // Must cover the largest allowed document upload (ServiceItem.maxSizeMb,
      // default 50 MB) plus multipart overhead. Large files should migrate to
      // presigned direct-to-Spaces uploads to take them off the action body.
      bodySizeLimit: "60mb",
    },
    // Every admin page in this app marks itself `force-dynamic`, but that
    // only controls server-side rendering — the client Router Cache still
    // caches the RSC payload for 30s (Next 15 default) on back/forward and
    // sibling-link navigation. Confirmed live: leave a running Label
    // Evaluator assessment (EXTRACTING/CLASSIFYING) via a nav link and come
    // back within 30s, and the page renders the stale pre-run snapshot,
    // making the in-progress run look like it vanished. dynamic: 0 makes
    // every such navigation refetch instead of reusing the cache.
    staleTimes: { dynamic: 0 },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
