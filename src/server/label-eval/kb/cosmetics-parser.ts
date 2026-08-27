import ExcelJS from "exceljs";
import { normaliseTitle } from "@/lib/bilingual-title";
import { SchemaContractError, type ParsedKbLookup, type ParsedKbRule } from "@/server/label-eval/kb/sfda-parser";

/**
 * Cosmetics KB parser — ingests the two real workbooks the design doc names:
 * "Enterprise Regulatory Intelligence Knowledge Base – Production Final"
 * (GSO 1943 label rules + COSING Annex II/III ingredient screens + SFDA
 * Shipment Testing List, one sheet, told apart by the `Standard / Regulatory
 * Source` column) and "Enriched Bilingual Enterprise Claims Intelligence KB –
 * GSO 2528" (claim-phase judgment items). Column anchors were verified
 * directly against the real files (openpyxl, cross-checked here with
 * exceljs), not inferred from header text — same discipline as
 * sfda-parser.ts.
 *
 * Two files in, one bundle out: cosmetics needs both workbooks together to
 * form one usable dataset (label rules alone can't assess ingredients or
 * claims), so activation always replaces the domain's complete rule set, not
 * one source at a time.
 */

export type ParsedCosmeticsBundle = {
  rules: ParsedKbRule[];
  lookups: ParsedKbLookup[];
  categories: { code: string; nameEn: string; nameAr: string; properties: string[] }[];
  warnings: string[];
};

const REGULATORY_SHEET = "Unified Enterprise Reg KB";
const CLAIMS_SHEET = "Enriched Claims Intelligence KB";

const SRC = {
  GSO_1943: "GSO 1943:2024",
  ANNEX_II: "COSING Annex II",
  ANNEX_III: "COSING Annex III",
  TESTING_LIST: "SFDA Shipment Testing List",
} as const;

/** Regulatory KB columns, 1-based (verified against the real file — see design doc §7.2 audit). */
const REG_COL = {
  ruleId: 1,
  standard: 3,
  clause: 4,
  subclause: 5,
  reqOriginal: 6,
  reqSimplified: 7,
  objective: 8,
  decisionLogic: 20,
  complianceResult: 22,
  riskLevel: 23,
  arabicTranslation: 30,
  englishTranslation: 31,
  ingredientName: 32,
  casNumber: 33,
  ecNumber: 34,
  annexReference: 35,
  regulatoryStatus: 36,
  maxConcentration: 37,
  applicableCategories: 38,
  restrictedBodyAreas: 39,
  restrictedUserGroups: 40,
  conditionsOfUse: 41,
  requiredWarningStatements: 42,
  requiredLabelStatements: 43,
  testName: 44,
  productType: 45,
  applicableProducts: 46,
  mandatoryOrConditional: 47,
  formulaBasedTriggers: 51,
} as const;

const CLAIMS_COL = {
  claimId: 1,
  productCategory: 2,
  productSubcategory: 3,
  claimAr: 4,
  claimEn: 5,
  claimType: 10,
  regulatoryClassification: 11,
  regulatoryStatus: 12,
  regulatoryRequirement: 13,
  regulatoryReason: 14,
  requiredScientificEvidence: 17,
  triggerKeywords: 22,
  negativeKeywords: 23,
  semanticMatchingKeywords: 25,
  ocrMatchingKeywords: 26,
  aiRecommendation: 32,
  suggestedAlternativeAr: 33,
  suggestedAlternativeEn: 34,
  regulatoryReferences: 35,
  recordType: 38,
} as const;

function cellText(row: ExcelJS.Row, col: number): string | null {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && "richText" in v) {
    return (v.richText as { text: string }[]).map((t) => t.text).join("").trim() || null;
  }
  if (typeof v === "object" && "text" in v) return String((v as { text: unknown }).text).trim() || null;
  const s = String(v).trim();
  return s || null;
}

function requireSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new SchemaContractError(`Missing expected sheet: "${name}"`);
  return ws;
}

/**
 * Product-category taxonomy for classification (design doc §1 Principle 4).
 * Hand-authored, NOT derived from the workbooks' own category columns —
 * "Applicable Product Categories" carries 120 inconsistent free-text values
 * (line breaks inside cells, OCR soft-hyphens) and isn't a usable taxonomy
 * as-is (design doc §7.2 audit). Drawn instead from the SFDA Shipment
 * Testing List's own `Test Name` grouping, the one genuinely clean taxonomy
 * either workbook contains — 16 categories, each corresponding to a real
 * SFDA shipment-testing product family, so `triggerCategoryCode` matching in
 * run-cosmetics.ts works immediately once a product is classified. This is a
 * DIFFERENT axis from the Claims KB's 5 broad categories (Skin/Hair/Oral
 * Care, Feminine Hygiene, General) — that axis is reserved for the future
 * claims-matching engine, not classification.
 *
 * `properties` seeds classify.ts's keyword matcher with real product-type
 * synonyms pulled from the source's own "required for X" phrasing — richer
 * signal than the bare category name alone.
 */
const CATEGORIES: { code: string; nameEn: string; nameAr: string; properties: string[] }[] = [
  { code: "hair_dyes", nameEn: "Hair Dyes", nameAr: "أصباغ الشعر", properties: ["hair dye", "hair color", "hair colour"] },
  { code: "hair_care", nameEn: "Hair Care Products", nameAr: "منتجات العناية بالشعر", properties: ["shampoo", "conditioner", "hair oil", "hair cream", "hair spray", "hair straightener", "anti-dandruff"] },
  { code: "mouth_care", nameEn: "Mouth Care Products", nameAr: "منتجات العناية بالفم", properties: ["toothpaste", "mouthwash", "oral care", "teeth"] },
  { code: "lip_care", nameEn: "Lip Care Products", nameAr: "منتجات العناية بالشفاه", properties: ["lipstick", "lip balm", "lip gloss"] },
  { code: "nail_products", nameEn: "Nail Products", nameAr: "منتجات الأظافر", properties: ["nail polish", "nail remover", "manicure"] },
  { code: "perfume_alcohol_wipes", nameEn: "Perfume, Alcohol & Wipes", nameAr: "العطور والكحول والمناديل", properties: ["perfume", "cologne", "alcohol cleanser", "wet wipes"] },
  { code: "hand_soap", nameEn: "Hand Soap", nameAr: "صابون اليدين", properties: ["hand soap", "liquid soap", "hand wash"] },
  { code: "talc_powders", nameEn: "Talc Powders", nameAr: "بودرة التلك", properties: ["talc", "baby powder", "talcum"] },
  { code: "deodorants_antiperspirants", nameEn: "Deodorants & Antiperspirants", nameAr: "مزيلات العرق ومضادات التعرق", properties: ["deodorant", "antiperspirant", "alum stick"] },
  { code: "depilatories", nameEn: "Depilatories", nameAr: "مزيلات الشعر", properties: ["hair removal cream", "depilatory", "waxing"] },
  { code: "skin_products", nameEn: "Skin Products", nameAr: "منتجات العناية بالبشرة", properties: ["moisturizer", "cream", "lotion", "serum", "sunscreen", "sunblock", "spf", "peeling", "exfoliant", "mineral makeup", "foundation"] },
  { code: "eye_products", nameEn: "Eye Products", nameAr: "منتجات العيون", properties: ["mascara", "eyeliner", "eyeshadow", "eyelash glue", "false lashes"] },
  { code: "henna_seder", nameEn: "Henna and Seder", nameAr: "الحناء والسدر", properties: ["henna", "seder"] },
  { code: "shaving_products", nameEn: "Shaving Products", nameAr: "منتجات الحلاقة", properties: ["shaving cream", "shaving foam", "after-shave", "razor gel"] },
  { code: "miswak", nameEn: "Miswak", nameAr: "السواك", properties: ["miswak", "siwak"] },
  { code: "oud_fragrance_oils", nameEn: "Oud & Fragrance Oils", nameAr: "العود وزيوت العطور", properties: ["oud", "fragrance oil", "perfume oil", "attar"] },
];

/** testName (as written in the source) -> categoryCode, for REQUIRED_TEST_RULE trigger matching. */
const TEST_NAME_TO_CATEGORY: Record<string, string> = {
  "Hair Dyes": "hair_dyes",
  "Hair Care Products": "hair_care",
  "Mouth Care Products": "mouth_care",
  "Lip Care Products": "lip_care",
  "Nail Products": "nail_products",
  "Perfume, Alcohol & Wipes": "perfume_alcohol_wipes",
  "Hand Soap": "hand_soap",
  "Talc Powders": "talc_powders",
  "Deodorants & Antiperspirants": "deodorants_antiperspirants",
  "Depilatories": "depilatories",
  "Skin Products": "skin_products",
  "Eye Products": "eye_products",
  "Henna and Seder": "henna_seder",
  "Shaving Products": "shaving_products",
  "Miswak": "miswak",
  "Oud & Fragrance Oils": "oud_fragrance_oils",
};

/**
 * GSO 1943 clause -> label-field mapping (design doc §7.2 audit — hand
 * reviewed against all 34 real rows, not inferred). Only the clause 5
 * labelling rows plus 4.2-01 are mapped — clauses 1, 4 and 6 are otherwise
 * excluded from the checklist, see EXCLUDED_GSO_1943_CLAUSES. Rows that check
 * something the label artwork alone can't answer (formulation composition,
 * lab data, packaging-format-conditional exemptions) are deliberately routed
 * to `requires_additional_data` rather than force-fit onto a field — a false
 * COMPLIANT on an order/nomenclature/composition check is a real compliance
 * risk, not a simplification worth taking (same reasoning as
 * sfda-parser.ts's CONDITIONAL_SUBSTANCE_TRIGGER handling).
 */
type GsoMapping =
  | { kind: "presence"; fieldKey: string | string[]; matchMode?: "all" | "any" }
  | { kind: "format"; fieldKey: string; formatPattern: string }
  | { kind: "ingredient_lookup" }
  | { kind: "requires_additional_data"; explanation: string };

const GSO_1943_MAPPING: Record<string, GsoMapping> = {
  "RULE-GSO1943-4.2-01": { kind: "ingredient_lookup" },
  "RULE-GSO1943-5.1-01": { kind: "presence", fieldKey: ["product_name", "brand"], matchMode: "all" },
  "RULE-GSO1943-5.2-01": { kind: "presence", fieldKey: "manufacturer_name_address" },
  "RULE-GSO1943-5.3-01": { kind: "presence", fieldKey: "country_of_origin" },
  "RULE-GSO1943-5.4-01": { kind: "presence", fieldKey: "net_content" },
  "RULE-GSO1943-5.5-01": { kind: "presence", fieldKey: ["exp_date", "pao"], matchMode: "any" },
  "RULE-GSO1943-5.6-01": { kind: "presence", fieldKey: "batch_number" },
  "RULE-GSO1943-5.7-01": { kind: "presence", fieldKey: "warnings" },
  "RULE-GSO1943-5.8-01": { kind: "presence", fieldKey: ["product_function", "directions"], matchMode: "all" },
  "RULE-GSO1943-5.5-01A": { kind: "presence", fieldKey: "mfg_date" },
  // 01B and 01C are mutually exclusive by the product's actual shelf life
  // (≤30 months requires expiry date; >30 months requires PAO instead) —
  // that duration is a formulation fact, not derivable from label artwork,
  // so neither sub-rule can be safely force-fit onto an unconditional
  // presence check on its own field (that would fail every product on
  // whichever field doesn't apply to its real shelf life). The parent rule
  // RULE-GSO1943-5.5-01 above already enforces the field-level requirement
  // correctly (`matchMode: "any"` on exp_date/pao) — these two stay routed
  // to manual review for the shelf-life-conditional determination itself,
  // same reasoning as 01D immediately below.
  "RULE-GSO1943-5.5-01B": { kind: "requires_additional_data", explanation: "Mandatory only when shelf life is ≤30 months — that duration isn't derivable from label artwork alone; needs a reviewer to confirm applicability." },
  "RULE-GSO1943-5.5-01C": { kind: "requires_additional_data", explanation: "Mandatory only when shelf life is >30 months — that duration isn't derivable from label artwork alone; needs a reviewer to confirm applicability." },
  "RULE-GSO1943-5.5-01D": { kind: "requires_additional_data", explanation: "PAO-exemption eligibility (sealed/single-use/pH extreme) depends on formulation data not on the label." },
  "RULE-GSO1943-5.6-01A": { kind: "presence", fieldKey: "warnings" },
  "RULE-GSO1943-5.6-01B": { kind: "requires_additional_data", explanation: "Professional-use warning only applies to professional-use products — needs a reviewer to confirm applicability before checking presence." },
  "RULE-GSO1943-5.6-01C": { kind: "requires_additional_data", explanation: "Hand-in-book leaflet exception applies only when package size makes label printing impractical — needs a reviewer to confirm applicability." },
  "RULE-GSO1943-5.8-01A": { kind: "presence", fieldKey: "product_function" },
  "RULE-GSO1943-5.9-01": { kind: "presence", fieldKey: "ingredients_list" },
  "RULE-GSO1943-5.9-01A": { kind: "format", fieldKey: "ingredients_list", formatPattern: "ingredients" },
  "RULE-GSO1943-5.9-01B": { kind: "requires_additional_data", explanation: "Fragrance-allergen declaration only applies when the formulation contains Annex III allergens — needs formulation data." },
  "RULE-GSO1943-5.9-01C": { kind: "requires_additional_data", explanation: "Descending-order-by-concentration is not verifiable from OCR text alone — needs formulation concentration data." },
  "RULE-GSO1943-5.9-01D": { kind: "requires_additional_data", explanation: "The '[nano]' tag is only required when the formulation actually contains a nanomaterial — needs formulation data." },
  "RULE-GSO1943-5.9-01E": { kind: "requires_additional_data", explanation: "CI-nomenclature correctness for colorants needs per-ingredient formulation review." },
  "RULE-GSO1943-5.9-01F": { kind: "requires_additional_data", explanation: "INCI-nomenclature correctness needs per-ingredient validation against the INCI dictionary." },
  "RULE-GSO1943-5.9-01G": { kind: "requires_additional_data", explanation: "Small-package leaflet exception applies only when package size makes label printing impractical — needs a reviewer to confirm applicability." },
};

/**
 * Clauses excluded from the label checklist. Clause 1 (scope) is settled by
 * product classification, clause 4 (safety: composition, microbial limits,
 * heavy metals) by the safety dossier and lab data, and clause 6 (packaging
 * & presentation) by packaging specs — none of the three is a check on the
 * label artwork, which is all this assessment covers. Rows are dropped at
 * parse time, so a re-import of the same workbook produces the same reduced
 * rule set.
 *
 * 4.2-01 is the one deliberate exception: it screens the printed INCI list
 * against COSING Annex II/III, which IS a label-artwork check and the only
 * auto-verifiable rule outside clause 5.
 */
const EXCLUDED_GSO_1943_CLAUSES = new Set(["1", "4", "6"]);

/** Rules kept despite their clause being excluded above. */
const KEPT_GSO_1943_RULE_IDS = new Set(["RULE-GSO1943-4.2-01"]);

/** GSO 1943 rows in the workbook, before the clause exclusion above. */
const EXPECTED_GSO_1943_COUNT = 34;

/** How many of those survive the exclusion and become checklist rules. */
const EXPECTED_GSO_1943_KEPT_COUNT = 25;

/** Leading clause number of a rule id, e.g. "RULE-GSO1943-5.9-01A" -> "5". */
function gso1943Clause(ruleId: string): string | null {
  return /^RULE-GSO1943-(\d+)\./.exec(ruleId)?.[1] ?? null;
}

function arabicFallback(ruleId: string, titleEn: string, arabicByCode: Record<string, string>): string {
  return arabicByCode[ruleId] ?? titleEn;
}

/** Hand-translated titles for the kept GSO 1943 rows — the source's own Arabic Translation column is empty for every row in this workbook. */
const GSO_1943_TITLE_AR: Record<string, string> = {
  "RULE-GSO1943-4.2-01": "متطلبات السلامة - المكونات",
  "RULE-GSO1943-5.1-01": "بطاقة البيان - اسم المنتج والعلامة التجارية",
  "RULE-GSO1943-5.2-01": "بطاقة البيان - اسم وعنوان الصانع/الموزع",
  "RULE-GSO1943-5.3-01": "بطاقة البيان - بلد المنشأ",
  "RULE-GSO1943-5.4-01": "بطاقة البيان - المحتوى الصافي",
  "RULE-GSO1943-5.5-01": "بطاقة البيان - تاريخ الانتهاء والفترة بعد الفتح",
  "RULE-GSO1943-5.6-01": "بطاقة البيان - رقم التشغيلة",
  "RULE-GSO1943-5.7-01": "بطاقة البيان - الاحتياطات والتحذيرات الخاصة",
  "RULE-GSO1943-5.8-01": "بطاقة البيان - الوظيفة وطريقة الاستخدام",
  "RULE-GSO1943-5.5-01A": "تتبع تاريخ التصنيع وحساب مدة الصلاحية الأساسية",
  "RULE-GSO1943-5.5-01B": "تاريخ انتهاء الصلاحية الإلزامي (مدة صلاحية ≤ 30 شهرًا)",
  "RULE-GSO1943-5.5-01C": "رمز الفترة بعد الفتح الإلزامي (مدة صلاحية > 30 شهرًا)",
  "RULE-GSO1943-5.5-01D": "شروط الإعفاء من رمز الفترة بعد الفتح",
  "RULE-GSO1943-5.6-01A": "تحذيرات إلزامية للمكونات المقيدة",
  "RULE-GSO1943-5.6-01B": "تحذيرات الاستخدام المهني",
  "RULE-GSO1943-5.6-01C": "استثناء رمز الدليل المرفق للعبوات الصغيرة",
  "RULE-GSO1943-5.8-01A": "بيان الوظيفة، أو الإعفاء منه إذا كانت واضحة من طريقة العرض",
  "RULE-GSO1943-5.9-01": "قائمة المكونات (INCI)",
  "RULE-GSO1943-5.9-01A": "عنوان \"المكونات\" الإلزامي",
  "RULE-GSO1943-5.9-01B": "بيان العطر ومسببات الحساسية",
  "RULE-GSO1943-5.9-01C": "الترتيب التنازلي للتركيز (> 1%)",
  "RULE-GSO1943-5.9-01D": "علامة [nano] الإلزامية للمواد النانوية",
  "RULE-GSO1943-5.9-01E": "قواعد إدراج الملونات (تسمية CI)",
  "RULE-GSO1943-5.9-01F": "الاستخدام الإلزامي لتسمية INCI",
  "RULE-GSO1943-5.9-01G": "استثناء نشرة العبوات الصغيرة",
};

function parseGso1943(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbRule[] {
  const rules: ParsedKbRule[] = [];
  let sourceRows = 0;
  const lastRow = ws.rowCount;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (cellText(row, REG_COL.standard) !== SRC.GSO_1943) continue;

    const ruleId = cellText(row, REG_COL.ruleId);
    if (!ruleId) {
      warnings.push(`Regulatory KB row ${r}: GSO 1943 row with no Rule ID — skipped.`);
      continue;
    }
    sourceRows++;

    const clause = gso1943Clause(ruleId);
    if (clause === null) {
      warnings.push(`Regulatory KB row ${r}: GSO 1943 rule "${ruleId}" has no recognisable clause number — skipped.`);
      continue;
    }
    if (EXCLUDED_GSO_1943_CLAUSES.has(clause) && !KEPT_GSO_1943_RULE_IDS.has(ruleId)) continue;

    const mapping = GSO_1943_MAPPING[ruleId];
    if (!mapping) {
      warnings.push(`Regulatory KB row ${r}: GSO 1943 rule "${ruleId}" has no field mapping in the parser — imported as requires_additional_data (needs a reviewer to classify).`);
    }
    const titleEn =
      normaliseTitle(cellText(row, REG_COL.reqSimplified)) ??
      normaliseTitle(cellText(row, REG_COL.reqOriginal)) ??
      ruleId;
    const resolvedMapping: GsoMapping = mapping ?? {
      kind: "requires_additional_data",
      explanation: "No field mapping defined for this rule yet — needs manual review.",
    };

    const basePayload: Record<string, unknown> = {
      standard: SRC.GSO_1943,
      clause: cellText(row, REG_COL.clause),
      subclause: cellText(row, REG_COL.subclause),
      requirementOriginal: cellText(row, REG_COL.reqOriginal),
      objective: cellText(row, REG_COL.objective),
      decisionLogic: cellText(row, REG_COL.decisionLogic),
      riskLevel: cellText(row, REG_COL.riskLevel),
    };

    let evaluatorKey: string;
    let autoVerifiable: boolean;
    let payload: Record<string, unknown>;
    if (resolvedMapping.kind === "presence") {
      evaluatorKey = "label_presence";
      autoVerifiable = true;
      payload = { ...basePayload, fieldKey: resolvedMapping.fieldKey, matchMode: resolvedMapping.matchMode };
    } else if (resolvedMapping.kind === "format") {
      evaluatorKey = "label_format";
      autoVerifiable = true;
      payload = { ...basePayload, fieldKey: resolvedMapping.fieldKey, formatPattern: resolvedMapping.formatPattern };
    } else if (resolvedMapping.kind === "ingredient_lookup") {
      evaluatorKey = "ingredient_lookup";
      autoVerifiable = true;
      payload = basePayload;
    } else {
      evaluatorKey = "requires_additional_data";
      autoVerifiable = false;
      payload = { ...basePayload, explanation: resolvedMapping.explanation };
    }

    rules.push({
      code: ruleId,
      ruleType: "LABEL_REQUIREMENT_ITEM",
      section: cellText(row, REG_COL.clause) ?? "GSO_1943",
      titleEn,
      titleAr: arabicFallback(ruleId, titleEn, GSO_1943_TITLE_AR),
      priority: cellText(row, REG_COL.riskLevel),
      evaluatorKey,
      autoVerifiable,
      payload,
    });
  }

  if (sourceRows !== EXPECTED_GSO_1943_COUNT) {
    throw new SchemaContractError(
      `Found ${sourceRows} GSO 1943 rows, expected exactly ${EXPECTED_GSO_1943_COUNT}. Refusing to import a partial dataset.`,
    );
  }
  if (rules.length !== EXPECTED_GSO_1943_KEPT_COUNT) {
    throw new SchemaContractError(
      `Kept ${rules.length} GSO 1943 label-requirement rules after excluding clauses ${[...EXCLUDED_GSO_1943_CLAUSES].join(", ")}, expected exactly ${EXPECTED_GSO_1943_KEPT_COUNT}. Refusing to import a partial dataset.`,
    );
  }
  return rules;
}

function parseCosingAnnexes(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbLookup[] {
  const lookups: ParsedKbLookup[] = [];
  const lastRow = ws.rowCount;
  let annexIiCount = 0;
  let annexIiiCount = 0;
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const source = cellText(row, REG_COL.standard);
    if (source !== SRC.ANNEX_II && source !== SRC.ANNEX_III) continue;

    const ingredient = cellText(row, REG_COL.ingredientName);
    if (!ingredient) {
      warnings.push(`Regulatory KB row ${r}: ${source} row has no Ingredient Name (INCI) — skipped.`);
      continue;
    }
    if (source === SRC.ANNEX_II) annexIiCount++;
    else annexIiiCount++;

    lookups.push({
      tableKey: source === SRC.ANNEX_II ? "cosing_annex_ii" : "cosing_annex_iii",
      payload: {
        ruleId: cellText(row, REG_COL.ruleId),
        ingredient,
        casNumber: cellText(row, REG_COL.casNumber),
        ecNumber: cellText(row, REG_COL.ecNumber),
        annexReference: cellText(row, REG_COL.annexReference),
        regulatoryStatus: cellText(row, REG_COL.regulatoryStatus),
        maxConcentration: cellText(row, REG_COL.maxConcentration),
        applicableCategories: cellText(row, REG_COL.applicableCategories),
        restrictedBodyAreas: cellText(row, REG_COL.restrictedBodyAreas),
        restrictedUserGroups: cellText(row, REG_COL.restrictedUserGroups),
        conditionsOfUse: cellText(row, REG_COL.conditionsOfUse),
        requiredWarningStatements: cellText(row, REG_COL.requiredWarningStatements),
        requiredLabelStatements: cellText(row, REG_COL.requiredLabelStatements),
      },
    });
  }

  const EXPECTED_ANNEX_II = 1758;
  const EXPECTED_ANNEX_III = 381;
  if (annexIiCount !== EXPECTED_ANNEX_II) {
    throw new SchemaContractError(`Parsed ${annexIiCount} COSING Annex II rows, expected exactly ${EXPECTED_ANNEX_II}. Refusing to import a partial dataset.`);
  }
  if (annexIiiCount !== EXPECTED_ANNEX_III) {
    throw new SchemaContractError(`Parsed ${annexIiiCount} COSING Annex III rows, expected exactly ${EXPECTED_ANNEX_III}. Refusing to import a partial dataset.`);
  }
  return lookups;
}

/** "Determination of Heavy metals" -> "heavy_metals". Strips the common method-verb prefixes the source uses, then slugifies. */
function slugifyTestName(formulaTrigger: string): string {
  const stripped = formulaTrigger.replace(/^(determination|detection)\s+of\s+/i, "").trim();
  return stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EXPECTED_TEST_COUNT = 88;

function parseRequiredTests(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbRule[] {
  const rules: ParsedKbRule[] = [];
  const lastRow = ws.rowCount;
  const unmappedTestNames = new Set<string>();

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (cellText(row, REG_COL.standard) !== SRC.TESTING_LIST) continue;

    const ruleId = cellText(row, REG_COL.ruleId);
    const testName = cellText(row, REG_COL.testName);
    const formulaTriggerText = cellText(row, REG_COL.formulaBasedTriggers);
    const applicability = cellText(row, REG_COL.applicableProducts); // "Mandatory" | "Conditional"
    const conditionText = cellText(row, REG_COL.mandatoryOrConditional);
    const productType = cellText(row, REG_COL.productType);
    const reqSimplified = cellText(row, REG_COL.reqSimplified);

    if (!ruleId || !testName || !formulaTriggerText) {
      warnings.push(`Regulatory KB row ${r}: SFDA Shipment Testing List row missing Rule ID/Test Name/Formula-based Trigger — skipped.`);
      continue;
    }

    const categoryCode = TEST_NAME_TO_CATEGORY[testName];
    if (!categoryCode) unmappedTestNames.add(testName);

    const isMandatory = applicability === "Mandatory";
    const testCode = slugifyTestName(formulaTriggerText);

    rules.push({
      code: ruleId,
      ruleType: "REQUIRED_TEST_RULE",
      section: categoryCode ?? testName,
      titleEn: testName,
      titleAr: CATEGORIES.find((c) => c.code === categoryCode)?.nameAr ?? testName,
      priority: null,
      evaluatorKey: "required_test_trigger",
      autoVerifiable: isMandatory,
      payload: {
        testCode,
        testLabel: formulaTriggerText,
        mandatory: true,
        reasonEn: reqSimplified,
        // No Arabic reason text in the source for individual lab-test rows —
        // composed from the hand-translated category name rather than
        // fabricating a full translation (documented gap, not silently absorbed).
        reasonAr: `اختبار مخبري مطلوب: ${CATEGORIES.find((c) => c.code === categoryCode)?.nameAr ?? testName}`,
        triggerSource: conditionText,
        productType,
        // Only "Mandatory" rows (keyed purely on Product Category) get a
        // working trigger key — "Conditional" rows (Product
        // Type/Sub-Type/Claim/ingredient-conditioned) need a reviewer to
        // judge applicability; there's no per-assessment sub-type detector
        // yet to safely auto-fire them (same reasoning as sfda-parser.ts's
        // CONDITIONAL_SUBSTANCE_TRIGGER handling — matching the wrong
        // dimension would silently mis-trigger).
        ...(isMandatory && categoryCode ? { triggerCategoryCode: categoryCode } : {}),
      },
    });
  }

  if (unmappedTestNames.size > 0) {
    warnings.push(`SFDA Shipment Testing List: ${unmappedTestNames.size} Test Name value(s) not in the category taxonomy — imported without a working trigger key: ${[...unmappedTestNames].join(", ")}.`);
  }
  const conditionalCount = rules.filter((r) => !r.autoVerifiable).length;
  warnings.push(`SFDA Shipment Testing List: ${rules.length - conditionalCount} of ${rules.length} rows auto-trigger on product category alone; ${conditionalCount} are Conditional (Product Type/Sub-Type/Claim/ingredient-dependent) and need manual review before being added to an assessment (design doc §7.2 audit — no per-assessment sub-type detector exists yet).`);

  if (rules.length !== EXPECTED_TEST_COUNT) {
    throw new SchemaContractError(
      `Parsed ${rules.length} SFDA Shipment Testing List rows, expected exactly ${EXPECTED_TEST_COUNT}. Refusing to import a partial dataset.`,
    );
  }
  return rules;
}

const EXPECTED_CLAIMS_COUNT = 102;

function parseClaims(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbRule[] {
  const rules: ParsedKbRule[] = [];
  const lastRow = ws.rowCount;
  let recordTypeMissing = 0;
  // The source's own Claim ID isn't reliably unique — several rows across
  // different real categories collapse onto the same truncated Arabic
  // category-slug template (e.g. "CLAIM-الع-1" reused 3 times). code must be
  // unique per kbVersion (schema @@unique([kbVersionId, code])), confirmed
  // live: importing raw Claim IDs threw a unique-constraint violation.
  // Disambiguate with the row number rather than silently dropping the
  // collided rows — the base Claim ID stays visible in the suffixed code.
  const seenCodes = new Map<string, number>();
  let collisionCount = 0;

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const claimId = cellText(row, CLAIMS_COL.claimId);
    if (!claimId) continue;

    let code = claimId;
    if (seenCodes.has(claimId)) {
      collisionCount++;
      code = `${claimId}-r${r}`;
    }
    seenCodes.set(claimId, (seenCodes.get(claimId) ?? 0) + 1);

    // The source writes a literal "0" — not a blank — in "Claim (English)"
    // for every General claim from CLAIM-GEN-3-2 on. Normalising it to null
    // here keeps the digit out of the LLM judgment prompt and the assistant's
    // KB search, both of which read titleEn directly rather than through the
    // UI's bilingual fallback. The Arabic text below still carries the real
    // question, so nothing is invented and the gap stays visible.
    const claimEn = normaliseTitle(cellText(row, CLAIMS_COL.claimEn));
    const claimAr = normaliseTitle(cellText(row, CLAIMS_COL.claimAr));
    const recordType = cellText(row, CLAIMS_COL.recordType);
    if (!recordType) recordTypeMissing++;

    rules.push({
      code,
      ruleType: "CLAIM_PHASE_ITEM",
      section: cellText(row, CLAIMS_COL.productCategory) ?? "General",
      titleEn: claimEn,
      titleAr: claimAr ?? claimEn ?? claimId,
      priority: null,
      evaluatorKey: "claim_phase_judgment",
      // No claim-matching engine wired yet (design doc §7.2 audit) — every
      // claim item needs a human look regardless of Record Type, so this
      // stays false across the board rather than implying more automation
      // than actually exists.
      autoVerifiable: false,
      payload: {
        recordType,
        productCategory: cellText(row, CLAIMS_COL.productCategory),
        productSubcategory: cellText(row, CLAIMS_COL.productSubcategory),
        claimType: cellText(row, CLAIMS_COL.claimType),
        regulatoryClassification: cellText(row, CLAIMS_COL.regulatoryClassification),
        regulatoryStatus: cellText(row, CLAIMS_COL.regulatoryStatus),
        regulatoryRequirement: cellText(row, CLAIMS_COL.regulatoryRequirement),
        regulatoryReason: cellText(row, CLAIMS_COL.regulatoryReason),
        requiredScientificEvidence: cellText(row, CLAIMS_COL.requiredScientificEvidence),
        triggerKeywords: cellText(row, CLAIMS_COL.triggerKeywords),
        negativeKeywords: cellText(row, CLAIMS_COL.negativeKeywords),
        semanticMatchingKeywords: cellText(row, CLAIMS_COL.semanticMatchingKeywords),
        ocrMatchingKeywords: cellText(row, CLAIMS_COL.ocrMatchingKeywords),
        aiRecommendation: cellText(row, CLAIMS_COL.aiRecommendation),
        suggestedAlternativeEn: cellText(row, CLAIMS_COL.suggestedAlternativeEn),
        suggestedAlternativeAr: cellText(row, CLAIMS_COL.suggestedAlternativeAr),
        regulatoryReferences: cellText(row, CLAIMS_COL.regulatoryReferences),
        // Surfaced for the future claims-matching engine (design doc §7.2
        // build order step 3) — this parser only loads the data.
        explanation: cellText(row, CLAIMS_COL.regulatoryReason) ?? cellText(row, CLAIMS_COL.regulatoryRequirement),
      },
    });
  }

  if (recordTypeMissing > 0) {
    warnings.push(`Claims KB: ${recordTypeMissing} row(s) have no Record Type — the future claims engine needs this column to distinguish claim/question/alternative-suggestion rows (design doc §7.2 audit).`);
  }
  if (collisionCount > 0) {
    warnings.push(`Claims KB: ${collisionCount} row(s) reused a Claim ID already seen earlier in the sheet (source data isn't unique — e.g. "CLAIM-الع-1" appears 3 times across different categories) — disambiguated with a "-r<row>" suffix rather than dropped. Confirmed live: importing the raw IDs violates the (kbVersionId, code) uniqueness constraint.`);
  }
  if (rules.length !== EXPECTED_CLAIMS_COUNT) {
    throw new SchemaContractError(
      `Parsed ${rules.length} claim rows, expected exactly ${EXPECTED_CLAIMS_COUNT}. Refusing to import a partial dataset.`,
    );
  }
  return rules;
}

export async function parseCosmeticsWorkbooks(
  regulatoryBuffer: Buffer,
  claimsBuffer: Buffer,
): Promise<ParsedCosmeticsBundle> {
  const warnings: string[] = [];

  const regWb = new ExcelJS.Workbook();
  await regWb.xlsx.load(regulatoryBuffer as unknown as ArrayBuffer);
  const regSheet = requireSheet(regWb, REGULATORY_SHEET);

  const claimsWb = new ExcelJS.Workbook();
  await claimsWb.xlsx.load(claimsBuffer as unknown as ArrayBuffer);
  const claimsSheet = requireSheet(claimsWb, CLAIMS_SHEET);

  const rules: ParsedKbRule[] = [
    ...parseGso1943(regSheet, warnings),
    ...parseRequiredTests(regSheet, warnings),
    ...parseClaims(claimsSheet, warnings),
  ];
  const lookups = parseCosingAnnexes(regSheet, warnings);

  return { rules, lookups, categories: CATEGORIES, warnings };
}

export { SchemaContractError };
