import type { MetadataRoute } from "next";

import { locales } from "@/lib/i18n/config";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/** Public pages only (per-locale). Authenticated portals are excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = baseUrl();
  const publicPaths = ["", "/verify"];
  const now = new Date();

  return locales.flatMap((locale) =>
    publicPaths.map((path) => ({
      url: `${base}/${locale}${path}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: path === "" ? 1 : 0.6,
    })),
  );
}
