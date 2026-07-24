import { checkPermission, requirePermission } from "@/lib/rbac";
import type { SessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

type AtlasPermission = Parameters<typeof requirePermission>[1];

/**
 * Page-level gate: redirect to the admin home with a denied flag instead of
 * rendering an EmptyState that looks like a data outage.
 */
export function requirePagePermission(
  session: SessionUser,
  permission: AtlasPermission,
  locale: string,
  fallbackPath = "/admin",
): void {
  if (checkPermission(session, permission)) return;
  redirect(`/${locale}${fallbackPath}?denied=1`);
}

/**
 * Client portal equivalent.
 */
export function requireClientPagePermission(
  session: SessionUser,
  permission: AtlasPermission,
  locale: string,
  fallbackPath = "/client/dashboard",
): void {
  if (checkPermission(session, permission)) return;
  redirect(`/${locale}${fallbackPath}?denied=1`);
}
