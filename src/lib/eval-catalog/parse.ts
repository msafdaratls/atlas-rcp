/**
 * Parse + validate a regulation workbook into a `RegulationPayload`.
 *
 * Everything that could produce a wrong catalog is a BLOCKING error carrying
 * its sheet and row, and nothing is written when any exist. Everything that is
 * merely suspicious is a warning, surfaced to the operator and stored on the
 * import — never silently swallowed.
 *
 * Deliberately pure (Buffer in, result out) so the whole contract is unit
 * testable without a database or a request.
 */
import ExcelJS from "exceljs";

import {
  readBoolean,
  readHsCode,
  readMultiValue,
  readText,
} from "@/lib/eval-catalog/cells";
import {
  FIRST_DATA_ROW,
  HEADER_ROW,
  HS_CODE_LENGTH,
  ITEM_CODE_PATTERN,
  MAX_REGULATION_CHECKLIST_ITEMS,
  MAX_STANDARD_CHECKLIST_ITEMS,
  MULTI_VALUE_SEPARATOR,
  SHEETS,
  type SheetSpec,
} from "@/lib/eval-catalog/workbook-schema";

/**
 * An issue names a message code plus its parameters, never a finished
 * sentence. The admin UI is bilingual, so the wording is resolved from the
 * message catalogue when it is rendered — a parser-authored English string
 * would appear untranslated on the Arabic page.
 */
export type ImportIssue = {
  sheet?: string;
  row?: number;
  column?: string;
  code: string;
  params?: Record<string, string | number>;
};

export type ChecklistItemInput = {
  code: string;
  titleEn: string;
  titleAr: string;
  reference?: string;
  conditional?: boolean;
};

export type StandardInput = {
  code: string;
  titleEn: string;
  titleAr: string;
  kind: "GENERAL" | "SPECIFIC";
  active: boolean;
  items: ChecklistItemInput[];
};

export type TariffItemInput = {
  hsCode: string;
  productTitleEn: string;
  productTitleAr: string;
  specificStandardCodes: string[];
  requiredCertificates: string[];
  conformityModule: string | null;
  active: boolean;
};

export type RegulationPayload = {
  serviceCode: string;
  code: string;
  titleEn: string;
  titleAr: string;
  /** `null` means the sheet was absent — leave the existing checklist alone. */
  generalChecklist: ChecklistItemInput[] | null;
  labelingChecklist: ChecklistItemInput[] | null;
  documentsChecklist: ChecklistItemInput[] | null;
  /** `null` means the sheet was absent — leave existing standards alone. */
  standards: StandardInput[] | null;
  tariffItems: TariffItemInput[] | null;
};

export type ParseResult =
  | { ok: true; payload: RegulationPayload; warnings: ImportIssue[] }
  | { ok: false; errors: ImportIssue[]; warnings: ImportIssue[] };

class Issues {
  readonly errors: ImportIssue[] = [];
  readonly warnings: ImportIssue[] = [];
  error(issue: ImportIssue) {
    this.errors.push(issue);
  }
  warn(issue: ImportIssue) {
    this.warnings.push(issue);
  }
}

/** Maps a sheet's declared columns onto actual column indices by header text. */
function resolveColumns(
  sheet: ExcelJS.Worksheet,
  spec: SheetSpec,
  issues: Issues,
): Record<string, number> | null {
  const headerRow = sheet.getRow(HEADER_ROW);
  const byHeader = new Map<string, number>();
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const text = readText(cell.value).toLowerCase();
    if (text) byHeader.set(text, col);
  });

  const map: Record<string, number> = {};
  let missing = false;
  for (const column of spec.columns) {
    const col = byHeader.get(column.header.toLowerCase());
    if (col === undefined) {
      if (column.required) {
        issues.error({
          sheet: spec.name,
          row: HEADER_ROW,
          code: "COLUMN_MISSING",
          params: { column: column.header },
        });
        missing = true;
      }
      continue;
    }
    map[column.key] = col;
  }
  return missing ? null : map;
}

function isRowEmpty(row: ExcelJS.Row, columns: Record<string, number>): boolean {
  return Object.values(columns).every((col) => readText(row.getCell(col).value) === "");
}

function requireText(
  row: ExcelJS.Row,
  columns: Record<string, number>,
  key: string,
  sheetName: string,
  label: string,
  issues: Issues,
): string | null {
  const col = columns[key];
  const value = col === undefined ? "" : readText(row.getCell(col).value);
  if (!value) {
    issues.error({ sheet: sheetName, row: row.number, column: label, code: "FIELD_REQUIRED", params: { field: label } });
    return null;
  }
  return value;
}

function optionalText(row: ExcelJS.Row, columns: Record<string, number>, key: string): string {
  const col = columns[key];
  return col === undefined ? "" : readText(row.getCell(col).value);
}

/** Reads any of the three identically-shaped checklist sheets. */
function parseChecklistSheet(
  workbook: ExcelJS.Workbook,
  spec: SheetSpec,
  maxItems: number,
  issues: Issues,
): ChecklistItemInput[] | null {
  const sheet = workbook.getWorksheet(spec.name);
  if (!sheet) return null;

  const columns = resolveColumns(sheet, spec, issues);
  if (!columns) return null;

  const items: ChecklistItemInput[] = [];
  const seen = new Map<string, number>();

  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number < FIRST_DATA_ROW || isRowEmpty(row, columns)) return;

    const code = requireText(row, columns, "itemCode", spec.name, "Item Code", issues);
    const titleEn = requireText(row, columns, "titleEn", spec.name, "Title (English)", issues);
    const titleAr = requireText(row, columns, "titleAr", spec.name, "Title (Arabic)", issues);
    if (!code || !titleEn || !titleAr) return;

    const normalised = code.toUpperCase();
    if (!ITEM_CODE_PATTERN.test(normalised)) {
      issues.error({
        sheet: spec.name,
        row: row.number,
        column: "Item Code",
        code: "ITEM_CODE_INVALID",
        params: { value: code },
      });
      return;
    }
    const previous = seen.get(normalised);
    if (previous !== undefined) {
      issues.error({
        sheet: spec.name,
        row: row.number,
        column: "Item Code",
        code: "ITEM_CODE_DUPLICATE",
        params: { value: normalised, firstRow: previous },
      });
      return;
    }
    seen.set(normalised, row.number);

    const conditional = readBoolean(
      columns.conditional === undefined ? "" : row.getCell(columns.conditional).value,
      false,
    );
    if (!conditional.ok) {
      issues.error({ sheet: spec.name, row: row.number, column: "Conditional", ...conditional.error });
      return;
    }

    const reference = optionalText(row, columns, "reference");
    items.push({
      code: normalised,
      titleEn,
      titleAr,
      ...(reference ? { reference } : {}),
      ...(conditional.value ? { conditional: true } : {}),
    });
  });

  if (items.length > maxItems) {
    issues.error({
      sheet: spec.name,
      code: "CHECKLIST_TOO_MANY",
      params: { count: items.length, max: maxItems },
    });
  }
  return items;
}

function parseStandards(workbook: ExcelJS.Workbook, issues: Issues): StandardInput[] | null {
  const spec = SHEETS.standards;
  const sheet = workbook.getWorksheet(spec.name);
  if (!sheet) return null;

  const columns = resolveColumns(sheet, spec, issues);
  if (!columns) return null;

  const standards = new Map<string, StandardInput>();
  const seenRow = new Map<string, number>();

  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number < FIRST_DATA_ROW || isRowEmpty(row, columns)) return;

    const code = requireText(row, columns, "standardCode", spec.name, "Standard Code", issues);
    const titleEn = requireText(row, columns, "titleEn", spec.name, "Title (English)", issues);
    const titleAr = requireText(row, columns, "titleAr", spec.name, "Title (Arabic)", issues);
    const kindRaw = requireText(row, columns, "kind", spec.name, "Kind", issues);
    if (!code || !titleEn || !titleAr || !kindRaw) return;

    const kind = kindRaw.toUpperCase();
    if (kind !== "GENERAL" && kind !== "SPECIFIC") {
      issues.error({
        sheet: spec.name,
        row: row.number,
        column: "Kind",
        code: "KIND_INVALID",
        params: { value: kindRaw },
      });
      return;
    }

    const previous = seenRow.get(code);
    if (previous !== undefined) {
      issues.error({
        sheet: spec.name,
        row: row.number,
        column: "Standard Code",
        code: "STANDARD_DUPLICATE",
        params: { value: code, firstRow: previous },
      });
      return;
    }
    seenRow.set(code, row.number);

    const active = readBoolean(
      columns.active === undefined ? "" : row.getCell(columns.active).value,
      true,
    );
    if (!active.ok) {
      issues.error({ sheet: spec.name, row: row.number, column: "Active", ...active.error });
      return;
    }

    standards.set(code, { code, titleEn, titleAr, kind, active: active.value, items: [] });
  });

  // Per-standard checklist rows live in their own sheet; attach them here so a
  // standard's items travel with it as one unit.
  const detailSpec = SHEETS.standardChecklists;
  const detailSheet = workbook.getWorksheet(detailSpec.name);
  if (detailSheet) {
    const detailColumns = resolveColumns(detailSheet, detailSpec, issues);
    if (detailColumns) {
      const seenItem = new Map<string, number>();
      detailSheet.eachRow({ includeEmpty: false }, (row) => {
        if (row.number < FIRST_DATA_ROW || isRowEmpty(row, detailColumns)) return;

        const standardCode = requireText(row, detailColumns, "standardCode", detailSpec.name, "Standard Code", issues);
        const code = requireText(row, detailColumns, "itemCode", detailSpec.name, "Item Code", issues);
        const titleEn = requireText(row, detailColumns, "titleEn", detailSpec.name, "Title (English)", issues);
        const titleAr = requireText(row, detailColumns, "titleAr", detailSpec.name, "Title (Arabic)", issues);
        if (!standardCode || !code || !titleEn || !titleAr) return;

        const standard = standards.get(standardCode);
        if (!standard) {
          issues.error({
            sheet: detailSpec.name,
            row: row.number,
            column: "Standard Code",
            code: "STANDARD_NOT_DEFINED",
            params: { value: standardCode, sheet: spec.name },
          });
          return;
        }

        const normalised = code.toUpperCase();
        if (!ITEM_CODE_PATTERN.test(normalised)) {
          issues.error({
            sheet: detailSpec.name,
            row: row.number,
            column: "Item Code",
            code: "ITEM_CODE_INVALID",
            params: { value: code },
          });
          return;
        }
        const dupKey = `${standardCode}::${normalised}`;
        const previous = seenItem.get(dupKey);
        if (previous !== undefined) {
          issues.error({
            sheet: detailSpec.name,
            row: row.number,
            column: "Item Code",
            code: "STANDARD_ITEM_DUPLICATE",
            params: { value: normalised, standard: standardCode, firstRow: previous },
          });
          return;
        }
        seenItem.set(dupKey, row.number);

        const conditional = readBoolean(
          detailColumns.conditional === undefined ? "" : row.getCell(detailColumns.conditional).value,
          false,
        );
        if (!conditional.ok) {
          issues.error({ sheet: detailSpec.name, row: row.number, column: "Conditional", ...conditional.error });
          return;
        }
        const reference = optionalText(row, detailColumns, "reference");

        standard.items.push({
          code: normalised,
          titleEn,
          titleAr,
          ...(reference ? { reference } : {}),
          ...(conditional.value ? { conditional: true } : {}),
        });
      });
    }
  }

  for (const standard of standards.values()) {
    if (standard.items.length > MAX_STANDARD_CHECKLIST_ITEMS) {
      issues.error({
        sheet: detailSpec.name,
        code: "STANDARD_CHECKLIST_TOO_MANY",
        params: { standard: standard.code, count: standard.items.length, max: MAX_STANDARD_CHECKLIST_ITEMS },
      });
    }
  }

  return [...standards.values()];
}

function parseTariffItems(workbook: ExcelJS.Workbook, issues: Issues): TariffItemInput[] | null {
  const spec = SHEETS.tariffItems;
  const sheet = workbook.getWorksheet(spec.name);
  if (!sheet) return null;

  const columns = resolveColumns(sheet, spec, issues);
  if (!columns) return null;

  const items: TariffItemInput[] = [];
  const seen = new Map<string, number>();

  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number < FIRST_DATA_ROW || isRowEmpty(row, columns)) return;

    const hs = readHsCode(row.getCell(columns.hsCode).value, HS_CODE_LENGTH);
    if (!hs.ok) {
      issues.error({ sheet: spec.name, row: row.number, column: "HS Code", ...hs.error });
      return;
    }
    if (hs.warning) {
      issues.warn({ sheet: spec.name, row: row.number, column: "HS Code", ...hs.warning });
    }

    const productTitleEn = requireText(row, columns, "productTitleEn", spec.name, "Product (English)", issues);
    const productTitleAr = requireText(row, columns, "productTitleAr", spec.name, "Product (Arabic)", issues);
    if (!productTitleEn || !productTitleAr) return;

    const previous = seen.get(hs.value);
    if (previous !== undefined) {
      issues.error({
        sheet: spec.name,
        row: row.number,
        column: "HS Code",
        code: "HS_DUPLICATE",
        params: { value: hs.value, firstRow: previous },
      });
      return;
    }
    seen.set(hs.value, row.number);

    const active = readBoolean(
      columns.active === undefined ? "" : row.getCell(columns.active).value,
      true,
    );
    if (!active.ok) {
      issues.error({ sheet: spec.name, row: row.number, column: "Active", ...active.error });
      return;
    }

    const conformityModule = optionalText(row, columns, "conformityModule");
    items.push({
      hsCode: hs.value,
      productTitleEn,
      productTitleAr,
      specificStandardCodes:
        columns.specificStandardCodes === undefined
          ? []
          : readMultiValue(row.getCell(columns.specificStandardCodes).value, MULTI_VALUE_SEPARATOR),
      requiredCertificates:
        columns.requiredCertificates === undefined
          ? []
          : readMultiValue(row.getCell(columns.requiredCertificates).value, MULTI_VALUE_SEPARATOR),
      conformityModule: conformityModule || null,
      active: active.value,
    });
  });

  return items;
}

/**
 * Cross-sheet checks — the ones that need the whole workbook in hand. Standard
 * codes are resolved against the sheet plus the regulation's existing rows
 * (passed in by the caller), never globally: two regulations may legitimately
 * use the same standard code.
 */
function crossValidate(
  payload: RegulationPayload,
  existingStandards: Map<string, "GENERAL" | "SPECIFIC">,
  issues: Issues,
) {
  const sheetStandards = new Map<string, "GENERAL" | "SPECIFIC">();
  for (const standard of payload.standards ?? []) sheetStandards.set(standard.code, standard.kind);

  const kindOf = (code: string) => sheetStandards.get(code) ?? existingStandards.get(code);

  const referenced = new Set<string>();
  for (const item of payload.tariffItems ?? []) {
    // NOTE: item codes deliberately do NOT have to be unique across the
    // standards linked to one tariff item. Every standard is scored in its own
    // section (`std:<id>`, see buildSections) with its own verdict map, so two
    // standards may both number their tests 1, 2, 3 — which is exactly how the
    // source regulations write them.
    for (const code of item.specificStandardCodes) {
      referenced.add(code);
      const kind = kindOf(code);
      if (!kind) {
        issues.error({
          sheet: SHEETS.tariffItems.name,
          column: "Specific Standard Codes",
          code: "TARIFF_STANDARD_UNKNOWN",
          params: { hsCode: item.hsCode, value: code },
        });
        continue;
      }
      if (kind === "GENERAL") {
        issues.error({
          sheet: SHEETS.tariffItems.name,
          column: "Specific Standard Codes",
          code: "TARIFF_STANDARD_IS_GENERAL",
          params: { hsCode: item.hsCode, value: code },
        });
        continue;
      }

    }

    if (item.specificStandardCodes.length === 0 && item.active) {
      issues.warn({
        sheet: SHEETS.tariffItems.name,
        code: "WARN_NO_SPECIFIC_STANDARD",
        params: { hsCode: item.hsCode },
      });
    }
  }

  for (const standard of payload.standards ?? []) {
    if (standard.kind === "SPECIFIC" && !referenced.has(standard.code) && standard.active) {
      issues.warn({
        sheet: SHEETS.standards.name,
        code: "WARN_STANDARD_UNREFERENCED",
        params: { value: standard.code },
      });
    }
    if (standard.items.length === 0 && standard.active) {
      issues.warn({
        sheet: SHEETS.standards.name,
        code: "WARN_STANDARD_EMPTY",
        params: { value: standard.code },
      });
    }
  }

  const hasGeneral =
    [...sheetStandards.values()].includes("GENERAL") ||
    [...existingStandards.values()].includes("GENERAL");
  if (payload.standards && !hasGeneral) {
    issues.warn({ sheet: SHEETS.standards.name, code: "WARN_NO_GENERAL_STANDARD" });
  }
}

export async function parseRegulationWorkbook(
  buffer: Buffer,
  options: {
    /** Existing standards for this regulation code, so references can resolve
     *  against rows the sheet does not restate. Empty for a new regulation. */
    existingStandards?: Map<string, "GENERAL" | "SPECIFIC">;
    allowedServiceCodes: readonly string[];
  },
): Promise<ParseResult> {
  const issues = new Issues();
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return {
      ok: false,
      errors: [{ code: "NOT_XLSX" }],
      warnings: [],
    };
  }

  const regulationSheet = workbook.getWorksheet(SHEETS.regulation.name);
  if (!regulationSheet) {
    return {
      ok: false,
      errors: [{ code: "SHEET_MISSING", params: { sheet: SHEETS.regulation.name } }],
      warnings: [],
    };
  }

  const regulationColumns = resolveColumns(regulationSheet, SHEETS.regulation, issues);
  if (!regulationColumns) {
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }

  const dataRows: ExcelJS.Row[] = [];
  regulationSheet.eachRow({ includeEmpty: false }, (row) => {
    if (row.number >= FIRST_DATA_ROW && !isRowEmpty(row, regulationColumns)) dataRows.push(row);
  });
  if (dataRows.length === 0) {
    return {
      ok: false,
      errors: [{ sheet: SHEETS.regulation.name, code: "REGULATION_NO_ROW" }],
      warnings: issues.warnings,
    };
  }
  if (dataRows.length > 1) {
    issues.error({ sheet: SHEETS.regulation.name, row: dataRows[1].number, code: "REGULATION_MULTIPLE_ROWS" });
  }

  const row = dataRows[0];
  const serviceCode = requireText(row, regulationColumns, "serviceCode", SHEETS.regulation.name, "Service Code", issues);
  const code = requireText(row, regulationColumns, "code", SHEETS.regulation.name, "Regulation Code", issues);
  const titleEn = requireText(row, regulationColumns, "titleEn", SHEETS.regulation.name, "Title (English)", issues);
  const titleAr = requireText(row, regulationColumns, "titleAr", SHEETS.regulation.name, "Title (Arabic)", issues);

  if (serviceCode && !options.allowedServiceCodes.includes(serviceCode)) {
    issues.error({
      sheet: SHEETS.regulation.name,
      row: row.number,
      column: "Service Code",
      code: "SERVICE_UNKNOWN",
      params: { value: serviceCode, allowed: options.allowedServiceCodes.join(", ") },
    });
  }

  const regulationCode = code ? code.toUpperCase().replace(/\s+/g, "_") : null;
  if (regulationCode && !/^[A-Z0-9_-]+$/.test(regulationCode)) {
    issues.error({
      sheet: SHEETS.regulation.name,
      row: row.number,
      column: "Regulation Code",
      code: "REGULATION_CODE_INVALID",
      params: { value: regulationCode },
    });
  }

  const payload: RegulationPayload = {
    serviceCode: serviceCode ?? "",
    code: regulationCode ?? "",
    titleEn: titleEn ?? "",
    titleAr: titleAr ?? "",
    generalChecklist: parseChecklistSheet(workbook, SHEETS.generalChecklist, MAX_REGULATION_CHECKLIST_ITEMS, issues),
    labelingChecklist: parseChecklistSheet(workbook, SHEETS.labelingChecklist, MAX_REGULATION_CHECKLIST_ITEMS, issues),
    documentsChecklist: parseChecklistSheet(workbook, SHEETS.documents, MAX_REGULATION_CHECKLIST_ITEMS, issues),
    standards: parseStandards(workbook, issues),
    tariffItems: parseTariffItems(workbook, issues),
  };

  crossValidate(payload, options.existingStandards ?? new Map(), issues);

  if (issues.errors.length > 0) {
    return { ok: false, errors: issues.errors, warnings: issues.warnings };
  }
  return { ok: true, payload, warnings: issues.warnings };
}
