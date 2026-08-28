/**
 * Writes a regulation out as a workbook the importer accepts verbatim, so the
 * maintenance loop is export → edit in Excel → re-upload. Built from the same
 * `SHEETS` contract the reader uses, so a column can never drift between them.
 */
import ExcelJS from "exceljs";

import type { ChecklistItemInput, RegulationPayload } from "@/lib/eval-catalog/parse";
import {
  HEADER_ROW,
  joinMultiValue,
  SHEETS,
  type SheetSpec,
} from "@/lib/eval-catalog/workbook-schema";

function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(spec.name, { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
  sheet.columns = spec.columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 24,
  }));
  const header = sheet.getRow(HEADER_ROW);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  // Force Text on columns that must survive a round trip — an HS code left in
  // General format comes back as a number with its leading zeros gone.
  for (const [index, column] of spec.columns.entries()) {
    if (column.text) sheet.getColumn(index + 1).numFmt = "@";
  }
  return sheet;
}

function checklistRows(items: ChecklistItemInput[]) {
  return items.map((item) => ({
    itemCode: item.code,
    titleEn: item.titleEn,
    titleAr: item.titleAr,
    reference: item.reference ?? "",
    conditional: item.conditional ? "yes" : "no",
  }));
}

/** Serialises a payload to .xlsx bytes. Also used to produce the blank template. */
export async function buildRegulationWorkbook(payload: RegulationPayload): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Atlas COC";
  workbook.created = new Date();

  addSheet(workbook, SHEETS.regulation).addRow({
    serviceCode: payload.serviceCode,
    code: payload.code,
    titleEn: payload.titleEn,
    titleAr: payload.titleAr,
  });

  addSheet(workbook, SHEETS.generalChecklist).addRows(checklistRows(payload.generalChecklist ?? []));
  addSheet(workbook, SHEETS.labelingChecklist).addRows(checklistRows(payload.labelingChecklist ?? []));
  addSheet(workbook, SHEETS.documents).addRows(checklistRows(payload.documentsChecklist ?? []));

  addSheet(workbook, SHEETS.standards).addRows(
    (payload.standards ?? []).map((standard) => ({
      standardCode: standard.code,
      titleEn: standard.titleEn,
      titleAr: standard.titleAr,
      kind: standard.kind,
      active: standard.active ? "yes" : "no",
    })),
  );

  addSheet(workbook, SHEETS.standardChecklists).addRows(
    (payload.standards ?? []).flatMap((standard) =>
      standard.items.map((item) => ({
        standardCode: standard.code,
        itemCode: item.code,
        titleEn: item.titleEn,
        titleAr: item.titleAr,
        reference: item.reference ?? "",
        conditional: item.conditional ? "yes" : "no",
      })),
    ),
  );

  const tariffSheet = addSheet(workbook, SHEETS.tariffItems);
  for (const item of payload.tariffItems ?? []) {
    const row = tariffSheet.addRow({
      hsCode: item.hsCode,
      productTitleEn: item.productTitleEn,
      productTitleAr: item.productTitleAr,
      specificStandardCodes: joinMultiValue(item.specificStandardCodes),
      requiredCertificates: joinMultiValue(item.requiredCertificates),
      conformityModule: item.conformityModule ?? "",
      active: item.active ? "yes" : "no",
    });
    // Belt and braces alongside the column numFmt: an explicitly string-typed
    // cell cannot be reinterpreted as a number when Excel reopens the file.
    row.getCell(1).value = item.hsCode;
    row.getCell(1).numFmt = "@";
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** A header-only workbook with one worked example row per sheet. */
export async function buildRegulationTemplate(serviceCode: string): Promise<Buffer> {
  return buildRegulationWorkbook({
    serviceCode,
    code: "NEW_REGULATION_CODE",
    titleEn: "New technical regulation (English title)",
    titleAr: "لائحة فنية جديدة (العنوان بالعربية)",
    generalChecklist: [
      {
        code: "A-01",
        titleEn: "Replace with the first general requirement",
        titleAr: "استبدل بالمتطلب العام الأول",
        reference: "Article 4 § 1",
        conditional: false,
      },
    ],
    labelingChecklist: [
      {
        code: "L-01",
        titleEn: "Replace with the first labeling requirement",
        titleAr: "استبدل بأول متطلب لبطاقة البيان",
        reference: "Article 5 § 1",
        conditional: false,
      },
    ],
    documentsChecklist: [
      {
        code: "D-01",
        titleEn: "Replace with the first required document",
        titleAr: "استبدل بأول مستند مطلوب",
        reference: "Article 6 § 3",
        conditional: false,
      },
    ],
    standards: [
      {
        code: "STD-GENERAL-1",
        titleEn: "A standard that applies to every product under this regulation",
        titleAr: "مواصفة تنطبق على كل منتج ضمن هذه اللائحة",
        kind: "GENERAL",
        active: true,
        items: [
          {
            code: "STD1-01",
            titleEn: "Replace with the first test/criterion of that standard",
            titleAr: "استبدل بأول اختبار أو معيار لتلك المواصفة",
          },
        ],
      },
      {
        code: "STD-SPECIFIC-1",
        titleEn: "A standard that applies only to certain products",
        titleAr: "مواصفة تنطبق على منتجات معيّنة فقط",
        kind: "SPECIFIC",
        active: true,
        items: [],
      },
    ],
    tariffItems: [
      {
        hsCode: "000000000000",
        productTitleEn: "Replace with the product this HS code covers",
        productTitleAr: "استبدل بالمنتج الذي يغطيه هذا الرمز الجمركي",
        specificStandardCodes: ["STD-SPECIFIC-1"],
        requiredCertificates: ["Quality Mark (QM)", "Product Certificate of Conformity (COC)"],
        conformityModule: "Type 3",
        active: true,
      },
    ],
  });
}
