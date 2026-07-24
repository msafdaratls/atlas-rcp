"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/lib/i18n/navigation";

/**
 * Public-page language toggle. Links to the same pathname under the other
 * locale so a visitor on /ar/login can jump straight to /en/login.
 */
export function LocaleSwitch({ locale }: { locale: "ar" | "en" }) {
  const pathname = usePathname();
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const other = locale === "ar" ? "en" : "ar";

  return (
    <Link
      href={pathname}
      locale={other}
      aria-label={tAuth("switchLanguage")}
      className="inline-flex h-9 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink-800)] transition-colors duration-150 ease-out hover:bg-[var(--surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--atlas-green)] focus-visible:ring-offset-2"
    >
      {other === "ar" ? tCommon("localeAr") : tCommon("localeEn")}
    </Link>
  );
}
