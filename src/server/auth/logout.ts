"use server";

import { signOut } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { requestMeta, writeAuditLog } from "@/lib/audit";

export async function logoutAction(locale: string) {
  const safeLocale = locale === "en" ? "en" : "ar";

  const session = await getSession();
  if (session) {
    const meta = await requestMeta();
    await writeAuditLog({
      session,
      action: "auth.logout",
      entityType: "User",
      entityId: session.id,
      ...meta,
    });
  }

  await signOut({ redirectTo: `/${safeLocale}/login` });
}
