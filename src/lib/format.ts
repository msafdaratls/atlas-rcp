import { arSA, enGB } from "date-fns/locale";

export function getDateFnsLocale(locale: string) {
  return locale === "ar" ? arSA : enGB;
}

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
  return new Intl.DateTimeFormat(
    locale === "ar" ? "ar-SA" : "en-GB",
    options ?? { dateStyle: "medium" },
  ).format(date);
}
