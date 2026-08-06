/**
 * Root not-found boundary — catches URLs that don't match the [locale]
 * segment at all (e.g. no /[locale] prefix), so it must render its own
 * <html>/<body> and cannot rely on any provider or i18n, same as
 * global-error.tsx.
 */
export default function RootNotFound() {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#F2F5F2",
          color: "#252821",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <div
            style={{
              height: 6,
              width: 64,
              margin: "0 auto 20px",
              borderRadius: 999,
              background: "#519E53",
            }}
          />
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 28,
              fontWeight: 600,
              color: "#519E53",
              margin: "0 0 8px",
            }}
          >
            404
          </p>
          <h1 style={{ fontSize: 22, margin: "0 0 8px", color: "#1C2229" }}>
            Page not found · الصفحة غير موجودة
          </h1>
          <p style={{ fontSize: 14, color: "#4D4D4D", margin: "0 0 20px" }}>
            The page you requested could not be found. · تعذّر العثور على
            الصفحة المطلوبة.
          </p>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- root boundary, can't depend on app router context */}
          <a
            href="/"
            style={{
              display: "inline-block",
              height: 40,
              lineHeight: "40px",
              padding: "0 20px",
              borderRadius: 8,
              background: "#519E53",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Home · الرئيسية
          </a>
        </main>
      </body>
    </html>
  );
}
