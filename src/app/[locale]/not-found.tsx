import { Button } from "@/components/ui/button";

/**
 * Locale-aware 404. next-intl can't read the [locale] param inside a not-found
 * boundary, so copy is inlined bilingually.
 */
export default function LocaleNotFound() {
  return (
    <main
      dir="rtl"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <p className="font-mono text-3xl font-semibold text-[var(--atlas-green-600)]">
        404
      </p>
      <h1 className="text-xl font-bold text-[var(--ink-900)]">
        الصفحة غير موجودة · Page not found
      </h1>
      <p className="text-sm text-[var(--ink-500)]">
        تعذّر العثور على الصفحة المطلوبة. · The page you requested could not be
        found.
      </p>
      <div className="flex gap-3 pt-1">
        <Button asChild>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- locale-root links from a boundary */}
          <a href="/ar">الرئيسية</a>
        </Button>
        <Button asChild variant="outline">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- locale-root links from a boundary */}
          <a href="/en">Home</a>
        </Button>
      </div>
    </main>
  );
}
