/**
 * Rule code -> confirmed-field key(s) to check for `presence`/`bilingual_presence`
 * evaluators. The source workbook does not encode this mapping — it names a
 * requirement in prose ("Is the batch/lot number present?"), not a field
 * key. This mapping was built by reading each item's title against the
 * field keys in src/server/label-eval/fields.ts. Like the parser's
 * evaluatorKey classification (sfda-parser.ts), this is a first-pass,
 * defensible mapping, not a claim of exhaustive SME sign-off — flagged here
 * so it's easy to find and correct.
 *
 * One key per logical field (not split by language) — LabelExtractedField
 * carries both valueEn/valueAr on the same row per fieldKey. Only GSO_9 and
 * FD_55 map to single scalar fields with confidence; FD_2233 items map to
 * the free-text `nutrition_table` field with a keyword hint
 * (FD_2233_KEYWORD_HINTS) rather than a dedicated structured field, since
 * this build does not parse the nutrition table into per-nutrient values —
 * an honest limitation, not a silent gap (see design doc §7.1 on FD 2233).
 */
export const SFDA_FIELD_MAP: Record<string, string[]> = {
  // GSO 9 — General Labeling
  GSO_9_01: ["product_name"],
  GSO_9_04: ["ingredients_list"],
  GSO_9_05: ["ingredients_list"],
  GSO_9_06: ["ingredients_list"],
  GSO_9_07: ["warnings"],
  GSO_9_08: ["net_content"],
  GSO_9_09: ["net_content"],
  GSO_9_10: ["manufacturer_name_address"],
  GSO_9_11: ["manufacturer_name_address"],
  GSO_9_12: ["country_of_origin"],
  GSO_9_13: ["mfg_date"],
  GSO_9_14: ["exp_date"],
  GSO_9_15: ["warnings"],
  GSO_9_16: ["batch_number"],

  // FD 55 — Dietary Supplement Requirements
  FD_55_01: ["product_function"],
  FD_55_02: ["product_function"],
  FD_55_03: ["product_function"],
  FD_55_04: ["product_function"],
  FD_55_05: ["product_name"],
  FD_55_06: ["product_function"],
  FD_55_07: ["directions"],
  FD_55_08: ["net_content"],
  FD_55_09: ["nutrition_table"],
  FD_55_10: ["nutrition_table"],
  FD_55_11: ["nutrition_table"],
  FD_55_12: ["ingredients_list"],
  FD_55_13: ["directions"],
  FD_55_14: ["directions"],
  FD_55_15: ["warnings"],
  FD_55_16: ["warnings"],
  FD_55_17: ["warnings"],
  FD_55_18: ["warnings"],
  FD_55_19: ["warnings"],
  FD_55_20: ["warnings"],
  FD_55_21: ["warnings"],
  FD_55_22: ["mfg_date"],
  FD_55_23: ["exp_date"],
};

/** For FD_2233 "is X listed" items mapped to the nutrition_table free-text field — a keyword to search for, since no per-nutrient structured field exists in this build. */
export const FD_2233_KEYWORD_HINTS: Record<string, string[]> = {
  FD_2233_03: ["nutrition", "تغذي"],
  FD_2233_04: ["energy", "calorie", "طاق", "سعر"],
  FD_2233_05: ["protein", "بروتين"],
  FD_2233_06: ["carbohydrate", "كربوهيدرات"],
  FD_2233_07: ["fat", "دهون"],
  FD_2233_08: ["saturated", "مشبع"],
  FD_2233_09: ["trans fat", "متحول"],
  FD_2233_10: ["cholesterol", "كوليسترول"],
  FD_2233_11: ["sodium", "صوديوم"],
  FD_2233_12: ["sugar", "سكر"],
  FD_2233_13: ["sugar", "سكر"],
};

/** Fields that must carry BOTH valueEn and valueAr confirmed (bilingual_presence evaluatorKey items — GSO_9_18, FD_55_24). */
export const SFDA_BILINGUAL_CHECK_FIELDS = [
  "product_name",
  "product_function",
  "warnings",
  "full_label_text",
];
