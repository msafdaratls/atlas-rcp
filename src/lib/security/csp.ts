/**
 * Content-Security-Policy, generated per-request in middleware (not
 * next.config.ts headers()) — kept here rather than a static header so it's
 * easy to make per-request again later.
 *
 * script-src needs 'unsafe-inline': a per-request nonce only lands in
 * Next.js's rendered <script> tags on dynamically-rendered pages, but this
 * app statically prerenders locale pages (next-intl's setRequestLocale +
 * generateStaticParams) for performance. On a static page the nonce baked
 * into the response header never matches (or is entirely absent from) the
 * build-time HTML, and 'strict-dynamic' — present in an earlier version of
 * this policy — then drops the 'self' fallback too, so every <script> tag on
 * every static page silently fails to load. That shipped 2026-08-23 and took
 * down all client-side JS sitewide (nothing hydrates, no click handlers run)
 * until this revert. Reintroducing a nonce needs the affected routes moved to
 * dynamic rendering first — tracked separately, not a quick follow-up.
 *
 * style-src also needs 'unsafe-inline': several components set dynamic
 * style={{}} attributes (SLA meter, wizard progress bar, analytics charts),
 * and nonces don't cover the style="" attribute in any browser — only
 * 'unsafe-inline' or a matching hash does.
 *
 * script-src needs 'unsafe-eval' too, but ONLY outside production: Next's
 * dev-mode Fast Refresh runtime evaluates strings as JS to apply hot
 * updates, which this policy otherwise blocks outright — every click
 * handler silently fails to attach on `next dev` (nothing throws visibly;
 * the page just stops responding to input). Production never does this, so
 * production's policy is unaffected.
 */
export function buildCsp(): string {
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
