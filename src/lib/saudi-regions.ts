export const SAUDI_REGIONS = [
  { code: "RIYADH", nameEn: "Riyadh", nameAr: "الرياض" },
  { code: "MAKKAH", nameEn: "Makkah", nameAr: "مكة المكرمة" },
  { code: "MADINAH", nameEn: "Madinah", nameAr: "المدينة المنورة" },
  { code: "EASTERN", nameEn: "Eastern Province", nameAr: "المنطقة الشرقية" },
  { code: "ASIR", nameEn: "Asir", nameAr: "عسير" },
  { code: "TABUK", nameEn: "Tabuk", nameAr: "تبوك" },
  { code: "HAIL", nameEn: "Hail", nameAr: "حائل" },
  { code: "NORTHERN_BORDERS", nameEn: "Northern Borders", nameAr: "الحدود الشمالية" },
  { code: "JAZAN", nameEn: "Jazan", nameAr: "جازان" },
  { code: "NAJRAN", nameEn: "Najran", nameAr: "نجران" },
  { code: "BAHAH", nameEn: "Al Bahah", nameAr: "الباحة" },
  { code: "JAWF", nameEn: "Al Jawf", nameAr: "الجوف" },
  { code: "QASSIM", nameEn: "Al Qassim", nameAr: "القصيم" },
] as const;

export type SaudiRegionCode = (typeof SAUDI_REGIONS)[number]["code"];

export function isSaudiRegionCode(value: string): value is SaudiRegionCode {
  return SAUDI_REGIONS.some((r) => r.code === value);
}

export function regionLabel(code: string, locale: string): string {
  const found = SAUDI_REGIONS.find((r) => r.code === code);
  if (!found) return code;
  return locale === "ar" ? found.nameAr : found.nameEn;
}
