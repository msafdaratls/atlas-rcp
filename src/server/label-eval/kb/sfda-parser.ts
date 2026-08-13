import ExcelJS from "exceljs";

/**
 * SFDA "Food Supplement Label Assessment" workbook parser (design doc §7.1).
 * Every row/column anchor below was verified directly against the real
 * source file (openpyxl, then cross-checked here with exceljs) — NOT
 * inferred from the sheet's own header text, because header rows shift
 * between sheets in this workbook (see FAMILY_A/FAMILY_B configs). A
 * generic "find the header row" parser silently misaligns columns on this
 * exact file; that is why every sheet gets its own explicit row range.
 */

export type ParsedKbRule = {
  code: string;
  ruleType: "CHECKLIST_ITEM";
  section: string;
  titleEn: string | null;
  titleAr: string;
  priority: string | null;
  evaluatorKey: string;
  autoVerifiable: boolean;
  payload: Record<string, unknown>;
};

export type ParsedKbLookup = {
  tableKey: string;
  payload: Record<string, unknown>;
};

export type ParsedSfdaBundle = {
  rules: ParsedKbRule[];
  lookups: ParsedKbLookup[];
  /** Named, surfaced warnings (design doc §7.4) — never silent drops. */
  warnings: string[];
};

class SchemaContractError extends Error {}

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
  if (!ws) {
    throw new SchemaContractError(`Missing expected sheet: "${name}"`);
  }
  return ws;
}

/**
 * Heuristic evaluatorKey classification (first pass — see design doc §6/§7.1
 * for the evaluator-type taxonomy). This is deliberately conservative: any
 * item whose Compliant-When/Decision-Rule text implies subjective judgment
 * or a formulation/lab value the artwork alone can't supply is marked
 * autoVerifiable=false rather than falsely automated. Flagged in the return
 * bundle's warnings so a reviewer can confirm/correct classifications before
 * relying on auto-verdicts in production — this is a starting point, not a
 * claim of exhaustive domain-expert review.
 */
const NEEDS_EXTERNAL_DATA = /maximum (permitted )?level|gmp requirement|calculated as|equivalent|mg\/kg|true average|tolerance|rounding|conversion factor|per 100 ?g|per 100 ?ml|%dv|daily value|declaration requirement/i;
const NEEDS_BILINGUAL = /arabic language|both languages|language complies|bilingual|language compl/i;
/**
 * Deliberately specific multi-word phrases only — a bare "clear" or
 * "appropriate" appears throughout presence-style Compliant-When prose
 * ("a clear product name appears...") without indicating real subjective
 * judgment, and over-triggered badly in first-pass testing against the real
 * workbook (GSO_9 item 1, a pure presence check, was wrongly flagged). Only
 * phrases that name an actual judgment call are matched.
 */
const NEEDS_JUDGMENT = /non-misleading|is.{0,15}misleading|true nature|easy to read|font size (is )?appropriate|meaningless|exaggerat|sufficient contrast|emphasiz(e|ing)|is.{0,10}verifiable\?/i;

function classifyFamilyA(titleEn: string, compliantWhen: string | null): { evaluatorKey: string; autoVerifiable: boolean } {
  const text = `${titleEn} ${compliantWhen ?? ""}`;
  if (NEEDS_EXTERNAL_DATA.test(text)) return { evaluatorKey: "requires_additional_data", autoVerifiable: false };
  if (NEEDS_BILINGUAL.test(text)) return { evaluatorKey: "bilingual_presence", autoVerifiable: true };
  if (NEEDS_JUDGMENT.test(text)) return { evaluatorKey: "wording_judgment", autoVerifiable: false };
  return { evaluatorKey: "presence", autoVerifiable: true };
}

function classifyFamilyB(titleEn: string, decisionRule: string | null): { evaluatorKey: string; autoVerifiable: boolean } {
  const text = `${titleEn} ${decisionRule ?? ""}`;
  if (NEEDS_EXTERNAL_DATA.test(text)) return { evaluatorKey: "requires_additional_data", autoVerifiable: false };
  return { evaluatorKey: "lookup", autoVerifiable: true };
}

type FamilyASheetConfig = {
  sheetName: string;
  sectionCode: string;
  standard: string;
  dataStartRow: number;
  itemCount: number;
  hasEnglishKb: boolean;
};

const FAMILY_A_SHEETS: FamilyASheetConfig[] = [
  { sheetName: "DB_SFDA - FD. GSO 9", sectionCode: "GSO_9", standard: "SFDA FD. GSO 9", dataStartRow: 7, itemCount: 19, hasEnglishKb: true },
  { sheetName: "DB_SFDA-.FD 55", sectionCode: "FD_55", standard: "SFDA.FD 55:2021", dataStartRow: 7, itemCount: 24, hasEnglishKb: false },
  { sheetName: "DB_SFDA FD 2233", sectionCode: "FD_2233", standard: "SFDA FD 2233", dataStartRow: 7, itemCount: 37, hasEnglishKb: true },
];

/** Family A columns: Verification Item | KB(En)* | KB(Ar) | Category | Evidence Required | Compliant When | Common Non-Conformities | Priority. *FD 55 omits KB(En) — 7 columns, one fewer. */
function parseFamilyASheet(wb: ExcelJS.Workbook, cfg: FamilyASheetConfig, warnings: string[]): ParsedKbRule[] {
  const ws = requireSheet(wb, cfg.sheetName);
  const rules: ParsedKbRule[] = [];

  for (let i = 0; i < cfg.itemCount; i++) {
    const rowNum = cfg.dataStartRow + i;
    const row = ws.getRow(rowNum);
    const col = cfg.hasEnglishKb
      ? { item: 1, kbEn: 2, kbAr: 3, category: 4, evidence: 5, compliantWhen: 6, nonConformities: 7, priority: 8 }
      : { item: 1, kbEn: null, kbAr: 2, category: 3, evidence: 4, compliantWhen: 5, nonConformities: 6, priority: 7 };

    const titleEn = cellText(row, col.item);
    if (!titleEn) {
      throw new SchemaContractError(
        `${cfg.sheetName} row ${rowNum}: expected item ${i + 1}/${cfg.itemCount} but Verification Item is empty`,
      );
    }
    const compliantWhen = cellText(row, col.compliantWhen);
    const priority = cellText(row, col.priority);
    const { evaluatorKey, autoVerifiable } = classifyFamilyA(titleEn, compliantWhen);

    rules.push({
      code: `${cfg.sectionCode}_${String(i + 1).padStart(2, "0")}`,
      ruleType: "CHECKLIST_ITEM",
      section: cfg.sectionCode,
      titleEn,
      titleAr: cellText(row, col.kbAr) ?? titleEn,
      priority,
      evaluatorKey,
      autoVerifiable,
      payload: {
        standard: cfg.standard,
        knowledgeBaseEn: col.kbEn ? cellText(row, col.kbEn) : null,
        knowledgeBaseAr: cellText(row, col.kbAr),
        category: cellText(row, col.category),
        evidenceRequired: cellText(row, col.evidence),
        compliantWhen,
        commonNonConformities: cellText(row, col.nonConformities),
      },
    });
  }

  if (!cfg.hasEnglishKb) {
    warnings.push(`${cfg.sheetName}: no English knowledge-base column in the source — all ${cfg.itemCount} items carry Arabic KB only (known, documented gap).`);
  }
  return rules;
}

type FamilyBSheetConfig = {
  sheetName: string;
  sectionCode: string;
  standard: string;
  mapDataStartRow: number;
  itemCount: number;
};

const FAMILY_B_SHEETS: FamilyBSheetConfig[] = [
  { sheetName: "DB_Food Additives", sectionCode: "FD_2500", standard: "SFDA-FD-2500-2021", mapDataStartRow: 6, itemCount: 19 },
  { sheetName: "DB_Health and Nutrition Claims", sectionCode: "FD_2333", standard: "SFDA FD 2333 / GSO 2022", mapDataStartRow: 7, itemCount: 14 },
];

/** Family B item-map columns: Section Item | Verification Item | Source Rule (Arabic) | Reference Range | Applicability/Search Key | Evidence Required | Decision Rule. No Compliant-When, no Priority column — a property of the source (design doc §7.1), not a parser gap. */
function parseFamilyBSheet(wb: ExcelJS.Workbook, cfg: FamilyBSheetConfig, warnings: string[]): ParsedKbRule[] {
  const ws = requireSheet(wb, cfg.sheetName);
  const rules: ParsedKbRule[] = [];

  for (let i = 0; i < cfg.itemCount; i++) {
    const rowNum = cfg.mapDataStartRow + i;
    const row = ws.getRow(rowNum);
    const titleEn = cellText(row, 2);
    if (!titleEn) {
      throw new SchemaContractError(
        `${cfg.sheetName} row ${rowNum}: expected item ${i + 1}/${cfg.itemCount} but Verification Item is empty`,
      );
    }
    const decisionRule = cellText(row, 7);
    const { evaluatorKey, autoVerifiable } = classifyFamilyB(titleEn, decisionRule);

    rules.push({
      code: `${cfg.sectionCode}_${String(i + 1).padStart(2, "0")}`,
      ruleType: "CHECKLIST_ITEM",
      section: cfg.sectionCode,
      titleEn,
      titleAr: cellText(row, 3) ?? titleEn,
      priority: null,
      evaluatorKey,
      autoVerifiable,
      payload: {
        standard: cfg.standard,
        sourceRuleAr: cellText(row, 3),
        referenceRange: cellText(row, 4),
        applicability: cellText(row, 5),
        evidenceRequired: cellText(row, 6),
        decisionRule,
      },
    });
  }

  warnings.push(`${cfg.sheetName}: no Compliant-When or Priority column in the source — these ${cfg.itemCount} items carry decisionRule/referenceRange/applicability instead (documented in design doc §7.1, not a parser gap).`);
  return rules;
}

/** Category 13.6 permitted additives: header row 27, data rows 28-76 (49 records, verified). */
function parseCategory136(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbLookup[] {
  const HEADER_ROW = 27;
  const DATA_START = 28;
  const EXPECTED_COUNT = 49;
  const header = cellText(ws.getRow(HEADER_ROW), 1);
  if (header !== "Additive") {
    throw new SchemaContractError(`DB_Food Additives row ${HEADER_ROW}: expected Category 13.6 header "Additive", found "${header}"`);
  }
  const out: ParsedKbLookup[] = [];
  for (let i = 0; i < EXPECTED_COUNT; i++) {
    const row = ws.getRow(DATA_START + i);
    const additive = cellText(row, 1);
    if (!additive) break;
    out.push({
      tableKey: "food_additives_category_13_6",
      payload: {
        additive,
        ins: cellText(row, 2),
        maxLevel: cellText(row, 3),
        notes: cellText(row, 4),
        sectionItems: cellText(row, 5),
        verificationGuidance: cellText(row, 6),
        sourceReference: cellText(row, 7),
      },
    });
  }
  if (out.length !== EXPECTED_COUNT) {
    warnings.push(`DB_Food Additives Category 13.6: expected ${EXPECTED_COUNT} records, parsed ${out.length}.`);
  }
  return out;
}

/** GMP additives identity/function table: header row 79, data rows 80-262 (183 records, verified). */
function parseGmpAdditives(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbLookup[] {
  const HEADER_ROW = 79;
  const DATA_START = 80;
  const EXPECTED_COUNT = 183;
  const header = cellText(ws.getRow(HEADER_ROW), 1);
  if (header !== "INS No") {
    throw new SchemaContractError(`DB_Food Additives row ${HEADER_ROW}: expected GMP table header "INS No", found "${header}"`);
  }
  const out: ParsedKbLookup[] = [];
  for (let i = 0; i < EXPECTED_COUNT; i++) {
    const row = ws.getRow(DATA_START + i);
    const ins = cellText(row, 1);
    const additive = cellText(row, 2);
    if (!additive) break;
    out.push({
      tableKey: "gmp_additives",
      payload: {
        ins,
        additive,
        functionalClass: cellText(row, 3),
        sourcePage: cellText(row, 4),
        sourceFile: cellText(row, 5),
        sectionItems: cellText(row, 6),
        verificationUse: cellText(row, 7),
        sourceReference: cellText(row, 8),
      },
    });
  }
  if (out.length !== EXPECTED_COUNT) {
    warnings.push(`DB_Food Additives GMP table: expected ${EXPECTED_COUNT} records, parsed ${out.length}.`);
  }
  // Self-declared gap in the source (row 25) — surfaced, never silently absorbed.
  if (!out.some((r) => /gelatin/i.test(String(r.payload.additive)))) {
    warnings.push(
      "DB_Food Additives: no Gelatin record in the GMP identity table (source's own row-25 note: \"Do not conclude compliance from database absence\"). Section 5 item 5 (gelatin/lecithin/mono-diglycerides sourcing) must stay REQUIRES_ADDITIONAL_DATA.",
    );
  }
  return out;
}

/** Table 1 (health claims) — header row 23, data 24-33 (10/376 sampled) and Table 2 (nutrition claims) — header row 37, data 38-65 (28/50 sampled). Both genuinely incomplete in this workbook (design doc §7.1) — parsed as-is and flagged, not padded or invented. */
function parseClaimTables(ws: ExcelJS.Worksheet, warnings: string[]): ParsedKbLookup[] {
  const out: ParsedKbLookup[] = [];

  const t1Header = cellText(ws.getRow(23), 2);
  if (t1Header !== "Nutrient/Substance") {
    throw new SchemaContractError(`DB_Health and Nutrition Claims row 23: expected Table 1 header "Nutrient/Substance", found "${t1Header}"`);
  }
  let t1Count = 0;
  for (let row = ws.getRow(24), r = 24; r <= 33; r++, row = ws.getRow(r)) {
    const nutrient = cellText(row, 2);
    if (!nutrient) break;
    t1Count++;
    out.push({
      tableKey: "sfda_health_claims_table1",
      payload: {
        nutrientOrSubstance: nutrient,
        healthClaim: cellText(row, 3),
        conditionsOfUse: cellText(row, 4),
        remarks: cellText(row, 5),
        sectionItems: cellText(row, 6),
        sourceReference: cellText(row, 7),
      },
    });
  }
  warnings.push(
    `DB_Health and Nutrition Claims Table 1: source declares 376 permitted health claims but only ${t1Count} are present (sample only, ending in a "See Table 1 for complete list" placeholder). Section 4 items 10-11 (health-claim table match) must stay REQUIRES_ADDITIONAL_DATA until the complete Table 1 is supplied — see design doc §12.`,
  );

  const t2Header = cellText(ws.getRow(37), 2);
  if (t2Header !== "Nutrient/Description") {
    throw new SchemaContractError(`DB_Health and Nutrition Claims row 37: expected Table 2 header "Nutrient/Description", found "${t2Header}"`);
  }
  let t2Count = 0;
  for (let row = ws.getRow(38), r = 38; r <= 65; r++, row = ws.getRow(r)) {
    const nutrient = cellText(row, 2);
    if (!nutrient) break;
    t2Count++;
    out.push({
      tableKey: "sfda_nutrition_claims_table2",
      payload: {
        nutrientOrDescription: nutrient,
        nutritionClaim: cellText(row, 3),
        conditionsOfUse: cellText(row, 4),
        remarks: cellText(row, 5),
        sectionItems: cellText(row, 6),
        sourceReference: cellText(row, 7),
      },
    });
  }
  warnings.push(
    `DB_Health and Nutrition Claims Table 2: source declares 50 permitted nutrition claims but only ${t2Count} are present (sample only). Section 4 items 12-13 (nutrition-claim table match) must stay REQUIRES_ADDITIONAL_DATA until the complete Table 2 is supplied — see design doc §12.`,
  );

  return out;
}

export async function parseSfdaWorkbook(buffer: Buffer): Promise<ParsedSfdaBundle> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const warnings: string[] = [];
  const rules: ParsedKbRule[] = [];
  const lookups: ParsedKbLookup[] = [];

  for (const cfg of FAMILY_A_SHEETS) rules.push(...parseFamilyASheet(wb, cfg, warnings));
  for (const cfg of FAMILY_B_SHEETS) rules.push(...parseFamilyBSheet(wb, cfg, warnings));

  const foodAdditivesSheet = requireSheet(wb, "DB_Food Additives");
  lookups.push(...parseCategory136(foodAdditivesSheet, warnings));
  lookups.push(...parseGmpAdditives(foodAdditivesSheet, warnings));

  const healthClaimsSheet = requireSheet(wb, "DB_Health and Nutrition Claims");
  lookups.push(...parseClaimTables(healthClaimsSheet, warnings));

  const EXPECTED_TOTAL = 113;
  if (rules.length !== EXPECTED_TOTAL) {
    throw new SchemaContractError(
      `Parsed ${rules.length} checklist items, expected exactly ${EXPECTED_TOTAL} (19+24+37+14+19). Refusing to import a partial dataset.`,
    );
  }

  return { rules, lookups, warnings };
}

export { SchemaContractError };
