import type { MetadataRoute } from "next";

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * Only the public marketing/verify surfaces are crawlable; the authenticated
 * client and admin portals and the API are disallowed.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/ar", "/en", "/ar/verify", "/en/verify"],
      disallow: [
        "/api/",
        "/ar/client",
        "/en/client",
        "/ar/admin",
        "/en/admin",
        "/ar/login",
        "/en/login",
        "/ar/signup",
        "/en/signup",
      ],
    },
    sitemap: `${baseUrl()}/sitemap.xml`,
  };
}
