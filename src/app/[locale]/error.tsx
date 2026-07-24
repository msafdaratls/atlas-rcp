"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Locale route error boundary. Deliberately self-contained — it must render
 * even when the failure is in i18n/data loading, so copy is inlined (bilingual)
 * rather than pulled from next-intl.
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const isAr = !pathname?.startsWith("/en");

  useEffect(() => {
    // Surface to the browser console; server logs capture the real stack.
    console.error(error);
  }, [error]);

  const t = isAr
    ? {
        title: "حدث خطأ غير متوقع",
        body: "تعذّر تحميل هذه الصفحة. حاول مرة أخرى، وإذا استمرت المشكلة تواصل مع الدعم.",
        retry: "إعادة المحاولة",
        home: "الصفحة الرئيسية",
      }
    : {
        title: "Something went wrong",
        body: "This page could not be loaded. Try again, and contact support if it persists.",
        retry: "Try again",
        home: "Home",
      };

  return (
    <main
      dir={isAr ? "rtl" : "ltr"}
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center"
    >
      <div className="h-1.5 w-16 rounded-full bg-[var(--atlas-green)]" />
      <h1 className="text-2xl font-bold text-[var(--ink-900)]">{t.title}</h1>
      <p className="text-sm text-[var(--ink-500)]">{t.body}</p>
      {error.digest ? (
        <p className="font-mono text-xs text-[var(--ink-500)]">
          {error.digest}
        </p>
      ) : null}
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center rounded-lg bg-[var(--atlas-green)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--atlas-green-600)]"
        >
          {t.retry}
        </button>
        <a
          href={isAr ? "/ar" : "/en"}
          className="inline-flex h-10 items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink-800)] transition-colors hover:bg-[var(--surface-alt)]"
        >
          {t.home}
        </a>
      </div>
    </main>
  );
}
