import type { LabelDocumentKind, LabelEvalDomain } from "@prisma/client";

/**
 * Extraction field targets per domain (design doc Appendix A / observed live
 * cosmetics tool fields, design doc §9). `mandatory` drives the verification
 * gate's Missing-fields banner — assessment cannot proceed until every
 * mandatory key has a non-empty confirmed value (either language, for
 * bilingual fields — presence evaluators decide per-item which language is
 * actually required against the KB rule's `Required language`).
 */
export type LabelFieldDef = {
  key: string;
  labelEn: string;
  labelAr: string;
  /** UI renders two boxes (EN+AR) for this one fieldKey rather than one — matches LabelExtractedField carrying both valueEn/valueAr per row, not two separate rows. */
  bilingual: boolean;
  mandatory: boolean;
};

const SHARED_FIELDS: LabelFieldDef[] = [
  { key: "product_name", labelEn: "Product name", labelAr: "اسم المنتج", bilingual: true, mandatory: true },
  { key: "brand", labelEn: "Brand", labelAr: "العلامة التجارية", bilingual: false, mandatory: true },
  { key: "manufacturer_name_address", labelEn: "Manufacturer/supplier name and address", labelAr: "اسم وعنوان الصانع/المورد", bilingual: false, mandatory: true },
  { key: "country_of_origin", labelEn: "Country of origin", labelAr: "بلد المنشأ", bilingual: false, mandatory: true },
  { key: "net_content", labelEn: "Net content", labelAr: "المحتوى الصافي", bilingual: false, mandatory: true },
  { key: "mfg_date", labelEn: "Manufacture date", labelAr: "تاريخ الإنتاج", bilingual: false, mandatory: false },
  { key: "exp_date", labelEn: "Expiry date", labelAr: "تاريخ انتهاء الصلاحية", bilingual: false, mandatory: true },
  { key: "batch_number", labelEn: "Batch number", labelAr: "رقم التشغيلة/الدفعة", bilingual: false, mandatory: true },
  { key: "product_function", labelEn: "Product function", labelAr: "وظيفة المنتج", bilingual: true, mandatory: true },
  { key: "warnings", labelEn: "Warnings and conditions of use", labelAr: "التحذيرات وشروط الاستخدام", bilingual: true, mandatory: true },
  { key: "ingredients_list", labelEn: "Ingredient list", labelAr: "قائمة المكوّنات", bilingual: false, mandatory: true },
  { key: "claims_detected", labelEn: "Detected claims", labelAr: "الادعاءات المكتشفة", bilingual: false, mandatory: false },
  { key: "full_label_text", labelEn: "Full label text", labelAr: "نص الملصق الكامل", bilingual: true, mandatory: true },
];

const SFDA_FIELDS: LabelFieldDef[] = [
  ...SHARED_FIELDS,
  { key: "nutrition_table", labelEn: "Nutrition facts (structured)", labelAr: "بطاقة الحقائق الغذائية", bilingual: false, mandatory: false },
  { key: "directions", labelEn: "Directions for use", labelAr: "طريقة الاستخدام", bilingual: true, mandatory: false },
];

const COSMETICS_FIELDS: LabelFieldDef[] = [
  ...SHARED_FIELDS,
  { key: "pao", labelEn: "Period after opening (PAO)", labelAr: "الفترة بعد الفتح", bilingual: false, mandatory: false },
  // GSO 1943 clause 5.8 requires directions for use alongside product
  // function (design doc §7.2 audit) — was missing entirely for this domain.
  { key: "directions", labelEn: "Directions for use", labelAr: "طريقة الاستخدام", bilingual: true, mandatory: false },
];

export const LABEL_FIELD_DEFS: Record<LabelEvalDomain, LabelFieldDef[]> = {
  SFDA_SUPPLEMENTS: SFDA_FIELDS,
  COSMETICS: COSMETICS_FIELDS,
};

/** All fieldKeys for a domain — one key per logical field regardless of bilingual. */
export function allFieldKeys(domain: LabelEvalDomain): string[] {
  return LABEL_FIELD_DEFS[domain].map((f) => f.key);
}

/** Fields that must have a non-empty confirmed value (valueEn or valueAr) before the verification gate opens. */
export function mandatoryFieldKeys(domain: LabelEvalDomain): LabelFieldDef[] {
  return LABEL_FIELD_DEFS[domain].filter((f) => f.mandatory);
}

/**
 * RequiredDocument.code -> LabelDocumentKind, per domain. This is the exact
 * set of catalogue-required documents the evaluator copies (storage.ts) and
 * extracts from — deliberately narrower than "every mandatory document" on
 * the service item (e.g. SFDA's COA and Claims-substantiation dossier are
 * mandatory for the request but are not label artwork; a client replacing
 * those must not force label re-evaluation, so the queue's
 * documentsFingerprint — src/server/label-eval/queries.ts — is scoped to
 * exactly these codes too).
 *
 * Verified against prisma/seed.ts: SFDA supplement items use ARTWORK/FORMULA
 * (seed.ts:714-733); SFDA-COS-001 (the only mapped cosmetics service) uses
 * PRODUCT_ARTWORK/INGREDIENT_LIST_INCI (seed.ts:892-903).
 */
export const DOCUMENT_KIND_BY_REQUIRED_CODE: Record<
  LabelEvalDomain,
  Record<string, LabelDocumentKind>
> = {
  SFDA_SUPPLEMENTS: {
    ARTWORK: "ARTWORK",
    FORMULA: "INGREDIENT_LIST",
  },
  COSMETICS: {
    PRODUCT_ARTWORK: "ARTWORK",
    INGREDIENT_LIST_INCI: "INGREDIENT_LIST",
  },
};
