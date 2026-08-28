"use server";

import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAvScanner } from "@/lib/av";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { parseCheckSets } from "@/lib/assessment";
import { prisma } from "@/lib/db";
import { diffRegulation, isEmptyDiff, type ExistingRegulation, type RegulationDiff } from "@/lib/eval-catalog/diff";
import { buildRegulationTemplate, buildRegulationWorkbook } from "@/lib/eval-catalog/export";
import { normaliseText } from "@/lib/eval-catalog/cells";
import { parseRegulationWorkbook, type ImportIssue, type RegulationPayload } from "@/lib/eval-catalog/parse";
import { requirePermission } from "@/lib/rbac";
import { getStorage } from "@/lib/storage";
import { TARIFF_EVAL_SERVICE_CODES } from "@/lib/tariff-evaluation-services";
import type { ActionResult } from "@/server/admin/workflow-actions";

/**
 * Regulation workbook import/export.
 *
 * Two phases, mirroring the Label Evaluator's KB flow: an upload parses,
 * validates and diffs, then stages the result as a PENDING `RegulationImport`
 * — nothing touches the catalog until an operator reviews the diff and
 * explicitly applies it.
 *
 * Applying is additive: rows absent from a sheet are left alone (an
 * accidentally filtered sheet must never be able to wipe a catalog), and
 * withdrawal is expressed with the `active` column instead.
 */

const MAX_UPLOAD_MB = 15;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

type FileValidation = { ok: true; buffer: Buffer; fileName: string } | { ok: false; error: string };

async function validateXlsxFile(file: unknown): Promise<FileValidation> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "NO_FILE" };
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: "FILE_TOO_LARGE" };
  if (file.type !== XLSX_MIME && !file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "MIME_REJECTED" };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!ZIP_MAGIC.every((b, i) => buffer[i] === b)) return { ok: false, error: "MIME_REJECTED" };
  const verdict = await getAvScanner().scan(buffer);
  if (verdict === "INFECTED") return { ok: false, error: "INFECTED_FILE" };
  return { ok: true, buffer, fileName: file.name };
}

/** Loads a regulation in the same shape the parser produces, so the two can be diffed directly. */
async function loadExistingRegulation(
  client: Prisma.TransactionClient | typeof prisma,
  serviceItemId: string,
  code: string,
): Promise<(ExistingRegulation & { id: string }) | null> {
  const regulation = await client.technicalRegulation.findUnique({
    where: { serviceItemId_code: { serviceItemId, code } },
    include: {
      standards: { orderBy: { code: "asc" } },
      tariffItems: {
        orderBy: { hsCode: "asc" },
        include: { specificStandards: { include: { standard: { select: { code: true } } } } },
      },
    },
  });
  if (!regulation) return null;

  // Stored text is normalised through the SAME helper the parser uses, so the
  // diff compares like with like. Without this, NFC's canonical reordering of
  // Arabic combining marks (shadda before damma) makes visually identical
  // titles compare unequal, and every re-upload reports phantom "updated"
  // rows. Applying an import then converges the stored value on NFC.
  const text = (value: string) => normaliseText(value);
  const flatten = (raw: Prisma.JsonValue) =>
    parseCheckSets(raw).flatMap((set) =>
      set.items.map((item) => ({
        code: item.code,
        titleEn: text(item.titleEn),
        titleAr: text(item.titleAr),
        ...(item.applicability ? { reference: text(item.applicability) } : {}),
        ...(item.priority === "conditional" ? { conditional: true } : {}),
      })),
    );

  return {
    id: regulation.id,
    code: regulation.code,
    titleEn: text(regulation.titleEn),
    titleAr: text(regulation.titleAr),
    generalChecklist: flatten(regulation.generalChecklist),
    labelingChecklist: flatten(regulation.labelingChecklist),
    documentsChecklist: flatten(regulation.documentsChecklist),
    standards: regulation.standards.map((standard) => ({
      code: standard.code,
      titleEn: text(standard.titleEn),
      titleAr: text(standard.titleAr),
      kind: standard.kind,
      active: standard.active,
      items: flatten(standard.checklist),
    })),
    tariffItems: regulation.tariffItems.map((item) => ({
      hsCode: item.hsCode,
      productTitleEn: text(item.productTitleEn),
      productTitleAr: text(item.productTitleAr),
      specificStandardCodes: item.specificStandards.map((l) => l.standard.code).sort(),
      requiredCertificates: item.requiredCertificates.map(text),
      conformityModule: item.conformityModule ? text(item.conformityModule) : null,
      active: item.active,
    })),
  };
}

/**
 * Identifies the catalog state a preview was built against. Re-checked at
 * apply so a preview built before someone else's change is refused rather
 * than applied on top of data the operator never saw.
 */
async function catalogFingerprint(
  client: Prisma.TransactionClient | typeof prisma,
  regulationId: string | null,
): Promise<string> {
  if (!regulationId) return "new-regulation";
  const [regulation, standards, tariffCount] = await Promise.all([
    client.technicalRegulation.findUnique({
      where: { id: regulationId },
      select: { updatedAt: true },
    }),
    client.standard.aggregate({
      where: { technicalRegulationId: regulationId },
      _max: { updatedAt: true },
      _count: true,
    }),
    client.tariffItem.count({ where: { technicalRegulationId: regulationId } }),
  ]);
  return createHash("sha256")
    .update(
      [
        regulation?.updatedAt?.toISOString() ?? "",
        standards._max.updatedAt?.toISOString() ?? "",
        standards._count,
        tariffCount,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

export type RegulationImportPreview = {
  importId: string;
  regulationCode: string;
  serviceCode: string;
  isNewRegulation: boolean;
  diff: RegulationDiff;
  warnings: ImportIssue[];
  noChanges: boolean;
};

/** Phase 1: validate, parse, diff, and stage. Nothing is written to the catalog. */
export async function uploadRegulationWorkbook(
  formData: FormData,
): Promise<ActionResult<RegulationImportPreview> & { issues?: ImportIssue[] }> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");

    const validated = await validateXlsxFile(formData.get("file"));
    if (!validated.ok) return { ok: false, error: validated.error };

    // The regulation's own standards must be resolvable even when the sheet
    // does not restate them, and only within this regulation — two regulations
    // may legitimately reuse a standard code.
    const probe = await parseRegulationWorkbook(validated.buffer, {
      allowedServiceCodes: TARIFF_EVAL_SERVICE_CODES,
    });
    const declaredCode = probe.ok ? probe.payload.code : null;
    const declaredService = probe.ok ? probe.payload.serviceCode : null;

    const serviceItem = declaredService
      ? await prisma.serviceItem.findFirst({ where: { code: declaredService }, select: { id: true } })
      : null;

    let existingStandards = new Map<string, "GENERAL" | "SPECIFIC">();
    if (serviceItem && declaredCode) {
      const rows = await prisma.standard.findMany({
        where: { technicalRegulation: { serviceItemId: serviceItem.id, code: declaredCode } },
        select: { code: true, kind: true },
      });
      existingStandards = new Map(rows.map((r) => [r.code, r.kind]));
    }

    const parsed = await parseRegulationWorkbook(validated.buffer, {
      allowedServiceCodes: TARIFF_EVAL_SERVICE_CODES,
      existingStandards,
    });
    if (!parsed.ok) return { ok: false, error: "INVALID_WORKBOOK", issues: parsed.errors };

    const payload = parsed.payload;
    if (!serviceItem) return { ok: false, error: "UNKNOWN_SERVICE" };

    // A regulation code already used under a DIFFERENT service would create a
    // second regulation rather than update the intended one, silently forking
    // the catalog and orphaning every evaluation pinned to the original.
    const conflicting = await prisma.technicalRegulation.findFirst({
      where: { code: payload.code, serviceItemId: { not: serviceItem.id } },
      select: { serviceItem: { select: { code: true } } },
    });
    if (conflicting) {
      return {
        ok: false,
        error: "REGULATION_CODE_CONFLICT",
        issues: [
          {
            sheet: "Regulation",
            code: "REGULATION_CODE_CROSS_SERVICE",
            params: { value: payload.code, service: conflicting.serviceItem.code },
          },
        ],
      };
    }

    const existing = await loadExistingRegulation(prisma, serviceItem.id, payload.code);

    // Changing a standard's kind rescopes it from "applies to every product"
    // to "applies to these products" or back, which silently changes what
    // every affected evaluation covers.
    const kindConflicts: ImportIssue[] = [];
    for (const standard of payload.standards ?? []) {
      const before = existing?.standards.find((s) => s.code === standard.code);
      if (before && before.kind !== standard.kind) {
        kindConflicts.push({
          sheet: "Standards",
          code: "STANDARD_KIND_FLIP",
          params: { value: standard.code, from: before.kind, to: standard.kind },
        });
      }
    }
    if (kindConflicts.length > 0) {
      return { ok: false, error: "STANDARD_KIND_CHANGED", issues: kindConflicts };
    }

    const evaluationCount = existing
      ? await prisma.tariffEvaluation.count({ where: { technicalRegulationId: existing.id } })
      : 0;
    const diff = diffRegulation(payload, existing, evaluationCount);
    const fingerprint = await catalogFingerprint(prisma, existing?.id ?? null);

    const checksum = createHash("sha256").update(validated.buffer).digest("hex");
    const stored = await getStorage().put({
      keyPrefix: "eval-catalog/imports",
      fileName: validated.fileName,
      mimeType: XLSX_MIME,
      body: validated.buffer,
    });

    const record = await prisma.regulationImport.create({
      data: {
        serviceItemId: serviceItem.id,
        regulationCode: payload.code,
        technicalRegulationId: existing?.id ?? null,
        sourceFilename: validated.fileName,
        storageKey: stored.key,
        checksum,
        catalogFingerprint: fingerprint,
        payload: payload as unknown as Prisma.InputJsonValue,
        diff: diff as unknown as Prisma.InputJsonValue,
        warnings: parsed.warnings.map(formatIssue),
        uploadedByUserId: session.id,
      },
      select: { id: true },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.import.upload",
      entityType: "RegulationImport",
      entityId: record.id,
      after: { regulationCode: payload.code, serviceCode: payload.serviceCode, isNew: !existing },
    });

    revalidatePath("/[locale]/admin/eval-catalog/import", "page");
    return {
      ok: true,
      data: {
        importId: record.id,
        regulationCode: payload.code,
        serviceCode: payload.serviceCode,
        isNewRegulation: !existing,
        diff,
        warnings: parsed.warnings,
        noChanges: isEmptyDiff(diff),
      },
    };
  } catch (error) {
    return failure(error, "UPLOAD_FAILED");
  }
}

/**
 * Warnings are persisted for the audit trail, not rendered — the UI translates
 * live issues from their codes. Store a stable, language-neutral line so a
 * record written today still reads the same after a copy change.
 */
function formatIssue(issue: ImportIssue): string {
  const where = [issue.sheet, issue.row ? `row ${issue.row}` : null, issue.column]
    .filter(Boolean)
    .join(" · ");
  const params = Object.entries(issue.params ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const body = params ? `${issue.code} (${params})` : issue.code;
  return where ? `${where}: ${body}` : body;
}

const applySchema = z.object({ importId: z.string().min(1) });

/** Phase 2: write the staged payload. Additive — nothing is deleted. */
export async function applyRegulationImport(
  input: z.infer<typeof applySchema>,
): Promise<ActionResult<{ regulationId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = applySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const record = await prisma.regulationImport.findUnique({ where: { id: parsed.data.importId } });
    if (!record) return { ok: false, error: "NOT_FOUND" };
    if (record.status !== "PENDING") return { ok: false, error: "ALREADY_RESOLVED" };

    const payload = record.payload as unknown as RegulationPayload;

    const regulationId = await prisma.$transaction(
      async (tx) => {
        // Claim the import first: if another operator already applied it this
        // updates zero rows and the whole transaction aborts.
        const claimed = await tx.regulationImport.updateMany({
          where: { id: record.id, status: "PENDING" },
          data: { status: "APPLIED", appliedByUserId: session.id, appliedAt: new Date() },
        });
        if (claimed.count === 0) throw new Error("ALREADY_RESOLVED");

        const existing = await tx.technicalRegulation.findUnique({
          where: { serviceItemId_code: { serviceItemId: record.serviceItemId, code: payload.code } },
          select: { id: true },
        });

        const fingerprint = await catalogFingerprint(tx, existing?.id ?? null);
        if (fingerprint !== record.catalogFingerprint) throw new Error("STALE_PREVIEW");

        const regulation = await tx.technicalRegulation.upsert({
          where: { serviceItemId_code: { serviceItemId: record.serviceItemId, code: payload.code } },
          create: {
            serviceItemId: record.serviceItemId,
            code: payload.code,
            titleEn: payload.titleEn,
            titleAr: payload.titleAr,
            ...checklistData(payload),
            updatedByUserId: session.id,
          },
          update: {
            titleEn: payload.titleEn,
            titleAr: payload.titleAr,
            ...checklistData(payload),
            updatedByUserId: session.id,
          },
          select: { id: true },
        });

        // Standards before tariff items, so link resolution below always finds them.
        const standardIdByCode = new Map<string, string>();
        for (const standard of payload.standards ?? []) {
          const row = await tx.standard.upsert({
            where: {
              technicalRegulationId_code: { technicalRegulationId: regulation.id, code: standard.code },
            },
            create: {
              technicalRegulationId: regulation.id,
              code: standard.code,
              titleEn: standard.titleEn,
              titleAr: standard.titleAr,
              kind: standard.kind,
              active: standard.active,
              checklist: toCheckSet(standard.code, standard.titleEn, standard.titleAr, standard.items),
              updatedByUserId: session.id,
            },
            update: {
              titleEn: standard.titleEn,
              titleAr: standard.titleAr,
              kind: standard.kind,
              active: standard.active,
              checklist: toCheckSet(standard.code, standard.titleEn, standard.titleAr, standard.items),
              updatedByUserId: session.id,
            },
            select: { id: true },
          });
          standardIdByCode.set(standard.code, row.id);
        }

        // Standards the sheet did not restate still need to resolve, because a
        // tariff item may reference one of them.
        if (payload.tariffItems && payload.tariffItems.length > 0) {
          const known = await tx.standard.findMany({
            where: { technicalRegulationId: regulation.id },
            select: { id: true, code: true },
          });
          for (const standard of known) {
            if (!standardIdByCode.has(standard.code)) standardIdByCode.set(standard.code, standard.id);
          }
        }

        for (const item of payload.tariffItems ?? []) {
          const row = await tx.tariffItem.upsert({
            where: {
              technicalRegulationId_hsCode: { technicalRegulationId: regulation.id, hsCode: item.hsCode },
            },
            create: {
              technicalRegulationId: regulation.id,
              hsCode: item.hsCode,
              productTitleEn: item.productTitleEn,
              productTitleAr: item.productTitleAr,
              requiredCertificates: item.requiredCertificates,
              conformityModule: item.conformityModule,
              active: item.active,
            },
            update: {
              productTitleEn: item.productTitleEn,
              productTitleAr: item.productTitleAr,
              requiredCertificates: item.requiredCertificates,
              conformityModule: item.conformityModule,
              active: item.active,
            },
            select: { id: true },
          });

          // Validation resolved every code before staging, so an unresolvable
          // one here means the catalog moved underneath us. Abort the whole
          // transaction rather than write the item with a link quietly missing.
          const linkIds = item.specificStandardCodes.map((code) => {
            const id = standardIdByCode.get(code);
            if (!id) throw new Error("STALE_PREVIEW");
            return id;
          });

          // The sheet states the complete link set for this item, so links it
          // omits are dropped — otherwise a standard removed upstream would
          // linger on the product forever.
          await tx.tariffItemStandard.deleteMany({
            where: { tariffItemId: row.id, standardId: { notIn: linkIds } },
          });
          if (linkIds.length > 0) {
            await tx.tariffItemStandard.createMany({
              data: linkIds.map((standardId, index) => ({
                tariffItemId: row.id,
                standardId,
                sortOrder: index,
              })),
              skipDuplicates: true,
            });
          }
        }

        await tx.regulationImport.update({
          where: { id: record.id },
          data: { technicalRegulationId: regulation.id },
        });

        return regulation.id;
      },
      // A 1,527-row catalog will not finish inside Prisma's 5s default.
      { timeout: 120_000, maxWait: 20_000 },
    );

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.import.apply",
      entityType: "RegulationImport",
      entityId: record.id,
      after: {
        regulationId,
        regulationCode: record.regulationCode,
        standards: payload.standards?.length ?? 0,
        tariffItems: payload.tariffItems?.length ?? 0,
      },
    });

    revalidatePath("/[locale]/admin/eval-catalog", "page");
    revalidatePath("/[locale]/admin/eval-catalog/import", "page");
    return { ok: true, data: { regulationId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "STALE_PREVIEW" || message === "ALREADY_RESOLVED") {
      // The claim was rolled back with the transaction, so the import stays
      // PENDING and can be re-previewed.
      return { ok: false, error: message };
    }
    return failure(error, "APPLY_FAILED");
  }
}

function checklistData(payload: RegulationPayload) {
  const data: Record<string, Prisma.InputJsonValue> = {};
  if (payload.generalChecklist)
    data.generalChecklist = toCheckSet("GENERAL", "General Checklist", "القائمة العامة", payload.generalChecklist);
  if (payload.labelingChecklist)
    data.labelingChecklist = toCheckSet("LABEL", "Labeling Information", "بيانات البطاقة الإيضاحية", payload.labelingChecklist);
  if (payload.documentsChecklist)
    data.documentsChecklist = toCheckSet("DOCUMENTS", "Required Documents", "المستندات المطلوبة", payload.documentsChecklist);
  return data;
}

function toCheckSet(
  code: string,
  titleEn: string,
  titleAr: string,
  items: RegulationPayload["generalChecklist"] & object,
): Prisma.InputJsonValue {
  return [
    {
      code,
      titleEn,
      titleAr,
      items: (items ?? []).map((item) => ({
        code: item.code,
        titleEn: item.titleEn,
        titleAr: item.titleAr,
        ...(item.reference ? { applicability: item.reference } : {}),
        ...(item.conditional ? { priority: "conditional" } : {}),
      })),
    },
  ] as unknown as Prisma.InputJsonValue;
}

export async function discardRegulationImport(
  input: z.infer<typeof applySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = applySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const discarded = await prisma.regulationImport.updateMany({
      where: { id: parsed.data.importId, status: "PENDING" },
      data: { status: "DISCARDED" },
    });
    if (discarded.count === 0) return { ok: false, error: "ALREADY_RESOLVED" };

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "evalCatalog.import.discard",
      entityType: "RegulationImport",
      entityId: parsed.data.importId,
    });

    revalidatePath("/[locale]/admin/eval-catalog/import", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "SAVE_FAILED");
  }
}

const exportSchema = z.object({ technicalRegulationId: z.string().min(1) });

/** Exports a regulation as a workbook this importer accepts verbatim. */
export async function exportRegulationWorkbook(
  input: z.infer<typeof exportSchema>,
): Promise<ActionResult<{ fileName: string; base64: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = exportSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const regulation = await prisma.technicalRegulation.findUnique({
      where: { id: parsed.data.technicalRegulationId },
      select: { serviceItemId: true, code: true, serviceItem: { select: { code: true } } },
    });
    if (!regulation) return { ok: false, error: "NOT_FOUND" };

    const existing = await loadExistingRegulation(prisma, regulation.serviceItemId, regulation.code);
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    const buffer = await buildRegulationWorkbook({
      serviceCode: regulation.serviceItem.code,
      code: existing.code,
      titleEn: existing.titleEn,
      titleAr: existing.titleAr,
      generalChecklist: existing.generalChecklist,
      labelingChecklist: existing.labelingChecklist,
      documentsChecklist: existing.documentsChecklist,
      standards: existing.standards,
      tariffItems: existing.tariffItems,
    });

    return {
      ok: true,
      data: { fileName: `${existing.code}.xlsx`, base64: buffer.toString("base64") },
    };
  } catch (error) {
    return failure(error, "EXPORT_FAILED");
  }
}

const templateSchema = z.object({ serviceCode: z.enum(TARIFF_EVAL_SERVICE_CODES) });

export async function downloadRegulationTemplate(
  input: z.infer<typeof templateSchema>,
): Promise<ActionResult<{ fileName: string; base64: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "eval-catalog:manage");
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const buffer = await buildRegulationTemplate(parsed.data.serviceCode);
    return {
      ok: true,
      data: { fileName: `regulation-template-${parsed.data.serviceCode}.xlsx`, base64: buffer.toString("base64") },
    };
  } catch (error) {
    return failure(error, "EXPORT_FAILED");
  }
}

function failure(error: unknown, fallback: string): ActionResult<never> {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
  return { ok: false, error: fallback };
}
