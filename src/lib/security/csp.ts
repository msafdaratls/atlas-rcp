/**
 * Content-Security-Policy, generated per-request in middleware (not
 * next.config.ts headers()) so script-src carries a random nonce instead of
 * 'unsafe-inline'. 'strict-dynamic' lets Next.js's own nonce'd bootstrap
 * script load its chunks without listing every hash; browsers that don't
 * support strict-dynamic fall back to 'self' + the nonce.
 *
 * style-src still needs 'unsafe-inline': several components set dynamic
 * style={{}} attributes (SLA meter, wizard progress bar, analytics charts),
 * and nonces don't cover the style="" attribute in any browser — only
 * 'unsafe-inline' or a matching hash does. Closing that needs a wider
 * refactor of those components to CSS custom properties, tracked separately.
 */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
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
