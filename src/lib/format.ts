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

/**
 * Fixed-width `YYYY-MM-DD HH:mm` stamp in Saudi local time, for data tables
 * and timelines. Slicing the raw ISO string instead would render the stored
 * UTC instant, which reads three hours behind the wall clock users see.
 */
export function formatStamp(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: APP_TIME_ZONE,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
