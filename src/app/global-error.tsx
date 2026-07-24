"use client";

import { useEffect } from "react";

/**
 * Root error boundary — catches failures in the root layout itself, so it must
 * render its own <html>/<body> and cannot rely on any provider or i18n.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

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
          <h1 style={{ fontSize: 22, margin: "0 0 8px", color: "#1C2229" }}>
            Something went wrong · حدث خطأ
          </h1>
          <p style={{ fontSize: 14, color: "#4D4D4D", margin: "0 0 20px" }}>
            An unexpected error occurred. Please try again. · حدث خطأ غير
            متوقع، حاول مرة أخرى.
          </p>
          <button
            onClick={reset}
            style={{
              height: 40,
              padding: "0 20px",
              border: "none",
              borderRadius: 8,
              background: "#519E53",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again · إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
