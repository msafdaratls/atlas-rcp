import assert from "node:assert/strict";
import { describe, it } from "node:test";

import ExcelJS from "exceljs";

import { normaliseDigits, normaliseText, readHsCode } from "@/lib/eval-catalog/cells";
import { diffRegulation, isEmptyDiff } from "@/lib/eval-catalog/diff";
import { buildRegulationWorkbook } from "@/lib/eval-catalog/export";
import { parseRegulationWorkbook, type RegulationPayload } from "@/lib/eval-catalog/parse";

const SERVICES = ["SAB-001", "SFDA-COS-002"] as const;

function basePayload(overrides: Partial<RegulationPayload> = {}): RegulationPayload {
  return {
    serviceCode: "SAB-001",
    code: "TEST_REG",
    titleEn: "Test regulation",
    titleAr: "لائحة اختبار",
    generalChecklist: [{ code: "A-01", titleEn: "General one", titleAr: "عام ١", reference: "Article 4" }],
    labelingChecklist: [{ code: "L-01", titleEn: "Label one", titleAr: "بطاقة ١" }],
    documentsChecklist: [{ code: "D-01", titleEn: "Doc one", titleAr: "مستند ١" }],
    standards: [
      {
        code: "STD-GEN",
        titleEn: "General standard",
        titleAr: "مواصفة عامة",
        kind: "GENERAL",
        active: true,
        items: [{ code: "G-01", titleEn: "Gen item", titleAr: "بند عام" }],
      },
      {
        code: "STD-SPEC",
        titleEn: "Specific standard",
        titleAr: "مواصفة خاصة",
        kind: "SPECIFIC",
        active: true,
        items: [{ code: "S-01", titleEn: "Spec item", titleAr: "بند خاص" }],
      },
    ],
    tariffItems: [
      {
        hsCode: "760719900001",
        productTitleEn: "Aluminium foil",
        productTitleAr: "رقائق ألومنيوم",
        specificStandardCodes: ["STD-SPEC"],
        requiredCertificates: ["Quality Mark (QM)"],
        conformityModule: "Type 3",
        active: true,
      },
    ],
    ...overrides,
  };
}

async function roundTrip(payload: RegulationPayload) {
  const buffer = await buildRegulationWorkbook(payload);
  return parseRegulationWorkbook(buffer, { allowedServiceCodes: SERVICES });
}

/** Edits one cell of a generated workbook, to exercise a specific failure. */
async function mutate(
  payload: RegulationPayload,
  sheetName: string,
  row: number,
  column: number,
  value: ExcelJS.CellValue,
) {
  const buffer = await buildRegulationWorkbook(payload);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  workbook.getWorksheet(sheetName)!.getRow(row).getCell(column).value = value;
  const out = await workbook.xlsx.writeBuffer();
  return parseRegulationWorkbook(Buffer.from(out), { allowedServiceCodes: SERVICES });
}

describe("regulation workbook round trip", () => {
  it("an exported workbook re-imports to the same payload", async () => {
    const payload = basePayload();
    const result = await roundTrip(payload);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.payload.code, "TEST_REG");
    assert.equal(result.payload.serviceCode, "SAB-001");
    assert.deepEqual(result.payload.generalChecklist, payload.generalChecklist);
    assert.deepEqual(result.payload.documentsChecklist, payload.documentsChecklist);
    assert.equal(result.payload.standards?.length, 2);
    assert.deepEqual(result.payload.tariffItems?.[0].specificStandardCodes, ["STD-SPEC"]);
  });

  it("keeps several specific standards on one tariff item", async () => {
    const payload = basePayload();
    payload.standards!.push({
      code: "STD-SPEC-2",
      titleEn: "Second specific",
      titleAr: "خاصة ثانية",
      kind: "SPECIFIC",
      active: true,
      items: [{ code: "S2-01", titleEn: "Second item", titleAr: "بند ثانٍ" }],
    });
    payload.tariffItems![0].specificStandardCodes = ["STD-SPEC", "STD-SPEC-2"];

    const result = await roundTrip(payload);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.payload.tariffItems?.[0].specificStandardCodes, ["STD-SPEC", "STD-SPEC-2"]);
  });
});

describe("regulation workbook validation", () => {
  it("rejects a service code that is not a tariff-evaluation service", async () => {
    const result = await roundTrip(basePayload({ serviceCode: "LAB-001" }));
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "SERVICE_UNKNOWN"));
  });

  it("rejects a specific-standard reference that no standard defines", async () => {
    const payload = basePayload();
    payload.tariffItems![0].specificStandardCodes = ["DOES-NOT-EXIST"];
    const result = await roundTrip(payload);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "TARIFF_STANDARD_UNKNOWN" && e.params?.value === "DOES-NOT-EXIST"));
  });

  it("rejects linking a GENERAL standard as a tariff item's specific standard", async () => {
    const payload = basePayload();
    payload.tariffItems![0].specificStandardCodes = ["STD-GEN"];
    const result = await roundTrip(payload);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "TARIFF_STANDARD_IS_GENERAL"));
  });

  it("ALLOWS two standards on one tariff item to reuse an item code", async () => {
    // Each standard is scored in its own section (`std:<id>`) with its own
    // verdict map, so per-standard numbering — how the source regulations
    // actually write their tests — must import cleanly.
    const payload = basePayload();
    payload.standards!.push({
      code: "STD-SPEC-2",
      titleEn: "Second specific",
      titleAr: "خاصة ثانية",
      kind: "SPECIFIC",
      active: true,
      items: [{ code: "S-01", titleEn: "Its own first test", titleAr: "اختبارها الأول" }],
    });
    payload.tariffItems![0].specificStandardCodes = ["STD-SPEC", "STD-SPEC-2"];

    const result = await roundTrip(payload);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const both = result.payload.standards!.filter((s) => s.items.some((i) => i.code === "S-01"));
    assert.equal(both.length, 2);
  });

  it("round-trips reference and conditional on a standard checklist item", async () => {
    const payload = basePayload();
    payload.standards!.find((s) => s.code === "STD-SPEC")!.items = [
      {
        code: "S-01",
        titleEn: "Migration test",
        titleAr: "اختبار الهجرة",
        reference: "Clause 5.2",
        conditional: true,
      },
    ];

    const result = await roundTrip(payload);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const item = result.payload.standards!.find((s) => s.code === "STD-SPEC")!.items[0];
    assert.equal(item.reference, "Clause 5.2");
    assert.equal(item.conditional, true);
  });

  it("rejects a duplicate HS code, naming the earlier row", async () => {
    const payload = basePayload();
    payload.tariffItems!.push({ ...payload.tariffItems![0], productTitleEn: "Duplicate" });
    const result = await roundTrip(payload);
    assert.equal(result.ok, false);
    if (result.ok) return;
    const issue = result.errors.find((e) => e.code === "HS_DUPLICATE");
    assert.ok(issue);
    assert.equal(issue?.sheet, "TariffItems");
    assert.equal(issue?.params?.firstRow, 2);
  });

  it("rejects a duplicate item code within a checklist", async () => {
    const payload = basePayload();
    payload.generalChecklist!.push({ code: "A-01", titleEn: "Clash", titleAr: "تعارض" });
    const result = await roundTrip(payload);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "ITEM_CODE_DUPLICATE"));
  });

  it("rejects an item code the checklist editor could never save", async () => {
    const payload = basePayload();
    payload.generalChecklist![0].code = "bad code!";
    const result = await roundTrip(payload);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "ITEM_CODE_INVALID"));
  });

  it("rejects an invalid Kind value", async () => {
    // Standards sheet: row 2 is the first data row, column 4 is Kind.
    const result = await mutate(basePayload(), "Standards", 2, 4, "MAYBE");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "KIND_INVALID"));
  });

  it("reports a missing required sheet rather than importing a partial catalog", async () => {
    const buffer = await buildRegulationWorkbook(basePayload());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    workbook.removeWorksheet(workbook.getWorksheet("Regulation")!.id);
    const out = await workbook.xlsx.writeBuffer();

    const result = await parseRegulationWorkbook(Buffer.from(out), { allowedServiceCodes: SERVICES });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.errors.some((e) => e.code === "SHEET_MISSING" && e.params?.sheet === "Regulation"));
  });

  it("treats an absent optional sheet as 'leave this checklist alone'", async () => {
    const buffer = await buildRegulationWorkbook(basePayload());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    workbook.removeWorksheet(workbook.getWorksheet("Documents")!.id);
    const out = await workbook.xlsx.writeBuffer();

    const result = await parseRegulationWorkbook(Buffer.from(out), { allowedServiceCodes: SERVICES });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.payload.documentsChecklist, null);
    assert.notEqual(result.payload.generalChecklist, null);
  });
});

describe("HS code cell reading — Excel's helpfulness is the hazard", () => {
  it("accepts a 12-digit numeric cell but warns to format the column as Text", () => {
    const read = readHsCode(760719900001, 12);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value, "760719900001");
    assert.equal(read.warning?.code, "HS_NUMERIC_CELL");
  });

  it("REJECTS a short numeric cell rather than padding a leading zero back on", () => {
    // 012345678901 typed into a General-formatted cell arrives as 12345678901.
    const read = readHsCode(12345678901, 12);
    assert.equal(read.ok, false);
    if (read.ok) return;
    assert.equal(read.error.code, "HS_NUMERIC_TRUNCATED");
  });

  it("preserves a leading zero that came through as text", () => {
    const read = readHsCode("012345678901", 12);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value, "012345678901");
    assert.equal(read.warning, undefined);
  });

  it("rejects scientific notation, whose digits are already lost", () => {
    const read = readHsCode("7.60719E+11", 12);
    assert.equal(read.ok, false);
    if (read.ok) return;
    assert.equal(read.error.code, "HS_SCIENTIFIC");
  });

  it("reads a rich-text cell (part of the value styled) as its plain text", () => {
    const read = readHsCode({ richText: [{ text: "7607" }, { text: "19900001" }] }, 12);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value, "760719900001");
  });

  it("normalises Arabic-Indic digits typed on an Arabic keyboard", () => {
    assert.equal(normaliseDigits("٧٦٠٧١٩٩٠٠٠٠١"), "760719900001");
    const read = readHsCode("٧٦٠٧١٩٩٠٠٠٠١", 12);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.value, "760719900001");
  });

  it("strips RTL marks and non-breaking spaces that break equality", () => {
    assert.equal(normaliseText("‏مواصفة عامة‎"), "مواصفة عامة");
  });
});

describe("diff — what an upload would actually change", () => {
  const existing = {
    id: "reg-1",
    code: "TEST_REG",
    titleEn: "Test regulation",
    titleAr: "لائحة اختبار",
    generalChecklist: [{ code: "A-01", titleEn: "General one", titleAr: "عام ١", reference: "Article 4" }],
    labelingChecklist: [{ code: "L-01", titleEn: "Label one", titleAr: "بطاقة ١" }],
    documentsChecklist: [{ code: "D-01", titleEn: "Doc one", titleAr: "مستند ١" }],
    standards: basePayload().standards!,
    tariffItems: basePayload().tariffItems!,
  };

  it("reports no changes when the sheet matches the catalog", () => {
    const diff = diffRegulation(basePayload(), existing, 0);
    assert.equal(isEmptyDiff(diff), true);
    assert.equal(diff.regulation.isNew, false);
  });

  it("reports a brand-new regulation", () => {
    const diff = diffRegulation(basePayload(), null, 0);
    assert.equal(diff.regulation.isNew, true);
    assert.deepEqual(diff.tariffItems.added, ["760719900001"]);
  });

  it("separates added, updated and unchanged tariff items", () => {
    const payload = basePayload();
    payload.tariffItems = [
      { ...payload.tariffItems![0], productTitleEn: "Renamed" },
      { ...payload.tariffItems![0], hsCode: "999999999999", productTitleEn: "Brand new" },
    ];
    const diff = diffRegulation(payload, existing, 0);
    assert.deepEqual(diff.tariffItems.updated, ["760719900001"]);
    assert.deepEqual(diff.tariffItems.added, ["999999999999"]);
    assert.equal(diff.tariffItems.unchanged, 0);
  });

  it("reports rows the sheet omits without proposing to delete them", () => {
    const payload = basePayload();
    payload.tariffItems = [];
    const diff = diffRegulation(payload, existing, 0);
    assert.deepEqual(diff.tariffItems.absentFromSheet, ["760719900001"]);
    assert.deepEqual(diff.tariffItems.added, []);
  });

  it("reports removed checklist codes so the operator sees what disappears", () => {
    const payload = basePayload();
    payload.generalChecklist = [{ code: "A-02", titleEn: "Replacement", titleAr: "بديل" }];
    const diff = diffRegulation(payload, existing, 0);
    assert.deepEqual(diff.generalChecklist.removed, ["A-01"]);
    assert.deepEqual(diff.generalChecklist.added, ["A-02"]);
  });

  it("leaves a checklist untouched when its sheet is absent", () => {
    const payload = basePayload({ documentsChecklist: null });
    const diff = diffRegulation(payload, existing, 0);
    assert.equal(diff.documentsChecklist.present, false);
    assert.deepEqual(diff.documentsChecklist.removed, []);
  });
});
