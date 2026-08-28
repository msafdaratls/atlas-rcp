/**
 * The regulation workbook contract — one definition shared by the reader
 * (parse.ts) and the writer (export.ts), so an exported file always re-imports
 * cleanly and a column can never drift between the two.
 *
 * Each sheet maps 1:1 onto a structure in the source HTML tools this catalog
 * was originally built from:
 *   Regulation         → the file's identity
 *   GeneralChecklist   → GENERAL_ITEMS + TEST_GENERAL_ITEMS
 *   LabelingChecklist  → LABEL_ITEMS
 *   Documents          → DOCS_ITEMS
 *   Standards          → STANDARD_TITLES + GENERAL_STANDARD_CODE(S)
 *   StandardChecklists → STANDARD_TEST_DETAILS
 *   TariffItems        → HS_CODES + PRODUCTS + HS_TO_PRODUCTS, flattened to one
 *                        row per HS code (which also removes the source tools'
 *                        multi-match ambiguity at authoring time)
 */

export type ColumnSpec = {
  key: string;
  header: string;
  required: boolean;
  /** Force Excel's text format on export — see hsCode in parse.ts. */
  text?: boolean;
  width?: number;
};

export type SheetSpec = {
  name: string;
  /** A single-row sheet (Regulation); more rows is an error. */
  singleRow?: boolean;
  /** Absent sheets are tolerated for these; the target is left untouched. */
  optional?: boolean;
  columns: ColumnSpec[];
};

const CHECKLIST_COLUMNS: ColumnSpec[] = [
  { key: "itemCode", header: "Item Code", required: true, width: 16 },
  { key: "titleEn", header: "Title (English)", required: true, width: 70 },
  { key: "titleAr", header: "Title (Arabic)", required: true, width: 70 },
  { key: "reference", header: "Reference", required: false, width: 28 },
  { key: "conditional", header: "Conditional (yes/no)", required: false, width: 18 },
];

export const SHEETS = {
  regulation: {
    name: "Regulation",
    singleRow: true,
    columns: [
      { key: "serviceCode", header: "Service Code", required: true, width: 18 },
      { key: "code", header: "Regulation Code", required: true, width: 34 },
      { key: "titleEn", header: "Title (English)", required: true, width: 70 },
      { key: "titleAr", header: "Title (Arabic)", required: true, width: 70 },
    ],
  },
  generalChecklist: { name: "GeneralChecklist", optional: true, columns: CHECKLIST_COLUMNS },
  labelingChecklist: { name: "LabelingChecklist", optional: true, columns: CHECKLIST_COLUMNS },
  documents: { name: "Documents", optional: true, columns: CHECKLIST_COLUMNS },
  standards: {
    name: "Standards",
    optional: true,
    columns: [
      { key: "standardCode", header: "Standard Code", required: true, width: 26 },
      { key: "titleEn", header: "Title (English)", required: true, width: 70 },
      { key: "titleAr", header: "Title (Arabic)", required: true, width: 70 },
      { key: "kind", header: "Kind (GENERAL/SPECIFIC)", required: true, width: 22 },
      { key: "active", header: "Active (yes/no)", required: false, width: 14 },
    ],
  },
  standardChecklists: {
    name: "StandardChecklists",
    optional: true,
    // Reference/Conditional are carried here too: a standard's items are read
    // back out with them (loadExistingRegulation), so a sheet that could not
    // express them would silently strip them on the next export -> re-import.
    columns: [
      { key: "standardCode", header: "Standard Code", required: true, width: 26 },
      { key: "itemCode", header: "Item Code", required: true, width: 16 },
      { key: "titleEn", header: "Title (English)", required: true, width: 70 },
      { key: "titleAr", header: "Title (Arabic)", required: true, width: 70 },
      { key: "reference", header: "Reference", required: false, width: 28 },
      { key: "conditional", header: "Conditional (yes/no)", required: false, width: 18 },
    ],
  },
  tariffItems: {
    name: "TariffItems",
    optional: true,
    columns: [
      { key: "hsCode", header: "HS Code", required: true, text: true, width: 18 },
      { key: "productTitleEn", header: "Product (English)", required: true, width: 60 },
      { key: "productTitleAr", header: "Product (Arabic)", required: true, width: 60 },
      {
        key: "specificStandardCodes",
        header: "Specific Standard Codes",
        required: false,
        width: 44,
      },
      { key: "requiredCertificates", header: "Required Certificates", required: false, width: 44 },
      { key: "conformityModule", header: "Conformity Module", required: false, width: 30 },
      { key: "active", header: "Active (yes/no)", required: false, width: 14 },
    ],
  },
} as const satisfies Record<string, SheetSpec>;

export type SheetKey = keyof typeof SHEETS;

/** Header row is row 1; data starts at row 2. */
export const HEADER_ROW = 1;
export const FIRST_DATA_ROW = 2;

/** Separator for multi-value cells (specific standards, certificates). */
export const MULTI_VALUE_SEPARATOR = /[\n;,|]/;

export function joinMultiValue(values: string[]): string {
  return values.join("\n");
}

/**
 * Item codes must satisfy the same contract the admin checklist editor
 * enforces (`eval-catalog-actions.ts`), otherwise an imported checklist could
 * never be saved again from the UI.
 */
export const ITEM_CODE_PATTERN = /^[A-Z0-9_-]+$/;
export const MAX_REGULATION_CHECKLIST_ITEMS = 100;
export const MAX_STANDARD_CHECKLIST_ITEMS = 200;

/** Both source regulations use 12-digit customs tariff items. */
export const HS_CODE_LENGTH = 12;
export const HS_CODE_PATTERN = /^\d{12}$/;
