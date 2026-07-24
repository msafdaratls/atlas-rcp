import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

/**
 * Security headers applied to every response. HSTS only takes effect over
 * HTTPS (behind the reverse proxy), so it is safe to send in all environments.
 * CSP is intentionally moderate: `'unsafe-inline'` is required for Next.js's
 * hydration bootstrap and Tailwind's injected styles. Tighten with nonces later.
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
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
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
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
