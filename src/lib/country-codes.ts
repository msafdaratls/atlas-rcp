/** Dial-code options for the phone country selector. Saudi Arabia is the default. */
export const COUNTRY_CODES = [
  { iso: "SA", dialCode: "+966", nameEn: "Saudi Arabia", nameAr: "السعودية", nsnLength: 9 },
  { iso: "AE", dialCode: "+971", nameEn: "United Arab Emirates", nameAr: "الإمارات", nsnLength: 9 },
  { iso: "KW", dialCode: "+965", nameEn: "Kuwait", nameAr: "الكويت", nsnLength: 8 },
  { iso: "QA", dialCode: "+974", nameEn: "Qatar", nameAr: "قطر", nsnLength: 8 },
  { iso: "BH", dialCode: "+973", nameEn: "Bahrain", nameAr: "البحرين", nsnLength: 8 },
  { iso: "OM", dialCode: "+968", nameEn: "Oman", nameAr: "عُمان", nsnLength: 8 },
  { iso: "EG", dialCode: "+20", nameEn: "Egypt", nameAr: "مصر", nsnLength: 10 },
  { iso: "JO", dialCode: "+962", nameEn: "Jordan", nameAr: "الأردن", nsnLength: 9 },
  { iso: "LB", dialCode: "+961", nameEn: "Lebanon", nameAr: "لبنان", nsnLength: 8 },
  { iso: "YE", dialCode: "+967", nameEn: "Yemen", nameAr: "اليمن", nsnLength: 9 },
  { iso: "US", dialCode: "+1", nameEn: "United States", nameAr: "الولايات المتحدة", nsnLength: 10 },
  { iso: "GB", dialCode: "+44", nameEn: "United Kingdom", nameAr: "المملكة المتحدة", nsnLength: 10 },
  { iso: "PK", dialCode: "+92", nameEn: "Pakistan", nameAr: "باكستان", nsnLength: 10 },
  { iso: "IN", dialCode: "+91", nameEn: "India", nameAr: "الهند", nsnLength: 10 },
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

export const DEFAULT_DIAL_CODE: CountryCode["dialCode"] = "+966";

export function findCountryByDialCode(dialCode: string): CountryCode | undefined {
  return COUNTRY_CODES.find((c) => c.dialCode === dialCode);
}

export function countryLabel(country: CountryCode, locale: string): string {
  return locale === "ar" ? country.nameAr : country.nameEn;
}
