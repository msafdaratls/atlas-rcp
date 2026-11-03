/**
 * Dial-code options for the phone country selector. Saudi Arabia is the default.
 *
 * `example` is a sample national significant number (no dial code, no leading
 * zero) used as the phone input's placeholder. Its length must equal
 * `nsnLength`, which is what the signup validator enforces.
 */
export const COUNTRY_CODES = [
  { iso: "SA", dialCode: "+966", nameEn: "Saudi Arabia", nameAr: "السعودية", nsnLength: 9, example: "512345678" },
  { iso: "AE", dialCode: "+971", nameEn: "United Arab Emirates", nameAr: "الإمارات", nsnLength: 9, example: "501234567" },
  { iso: "KW", dialCode: "+965", nameEn: "Kuwait", nameAr: "الكويت", nsnLength: 8, example: "50123456" },
  { iso: "QA", dialCode: "+974", nameEn: "Qatar", nameAr: "قطر", nsnLength: 8, example: "33123456" },
  { iso: "BH", dialCode: "+973", nameEn: "Bahrain", nameAr: "البحرين", nsnLength: 8, example: "36001234" },
  { iso: "OM", dialCode: "+968", nameEn: "Oman", nameAr: "عُمان", nsnLength: 8, example: "92123456" },
  { iso: "EG", dialCode: "+20", nameEn: "Egypt", nameAr: "مصر", nsnLength: 10, example: "1001234567" },
  { iso: "JO", dialCode: "+962", nameEn: "Jordan", nameAr: "الأردن", nsnLength: 9, example: "791234567" },
  { iso: "LB", dialCode: "+961", nameEn: "Lebanon", nameAr: "لبنان", nsnLength: 8, example: "71123456" },
  { iso: "YE", dialCode: "+967", nameEn: "Yemen", nameAr: "اليمن", nsnLength: 9, example: "712345678" },
  { iso: "US", dialCode: "+1", nameEn: "United States", nameAr: "الولايات المتحدة", nsnLength: 10, example: "2015550123" },
  { iso: "GB", dialCode: "+44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة", nsnLength: 10, example: "7400123456" },
  { iso: "PK", dialCode: "+92", nameEn: "Pakistan", nameAr: "باكستان", nsnLength: 10, example: "3001234567" },
  { iso: "IN", dialCode: "+91", nameEn: "India", nameAr: "الهند", nsnLength: 10, example: "9876543210" },
  { iso: "KR", dialCode: "+82", nameEn: "South Korea", nameAr: "كوريا الجنوبية", nsnLength: 10, example: "1012345678" },
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

export const DEFAULT_DIAL_CODE: CountryCode["dialCode"] = "+966";

export function findCountryByDialCode(dialCode: string): CountryCode | undefined {
  return COUNTRY_CODES.find((c) => c.dialCode === dialCode);
}

export function countryLabel(country: CountryCode, locale: string): string {
  return locale === "ar" ? country.nameAr : country.nameEn;
}

/** Placeholder for the phone input: the selected country's sample national number. */
export function phonePlaceholder(dialCode: string): string {
  return findCountryByDialCode(dialCode)?.example ?? "";
}
