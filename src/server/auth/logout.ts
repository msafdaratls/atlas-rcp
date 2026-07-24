"use server";

import { signOut } from "@/lib/auth";

export async function logoutAction(locale: string) {
  const safeLocale = locale === "en" ? "en" : "ar";
  await signOut({ redirectTo: `/${safeLocale}/login` });
}
