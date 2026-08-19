import { arSA, enGB } from "date-fns/locale";

export function getDateFnsLocale(locale: string) {
  return locale === "ar" ? arSA : enGB;
}

/**
 * Pin all date/time formatting to Saudi local time. Without an explicit
 * `timeZone`, `Intl.DateTimeFormat` falls back to the runtime's own default
 * zone — the app server runs in UTC while a browser typically doesn't, so a
 * "use client" component calling this during its server-rendered pass and
 * again during client hydration would format the same instant into two
 * different strings, which React reports as a hydration mismatch (error
 * #418). Fixing it here, at the one shared formatter, closes that off for
 * every caller instead of each component guarding it separately.
 */
export const APP_TIME_ZONE = "Asia/Riyadh";

export function formatCurrency(amount: number | string, locale: string) {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    style: "currency",
    currency: "SAR",
  }).format(value);
}

export function formatNumber(value: number, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB").format(
    value,
  );
}

export function formatDate(
  value: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    dateStyle: "medium",
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

/** Date + time, for audit trails and logs. */
export function formatDateTime(value: Date | string, locale: string) {
  return formatDate(value, locale, {
    dateStyle: "short",
    timeStyle: "short",
  });
}
