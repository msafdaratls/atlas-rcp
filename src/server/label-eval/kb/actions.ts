"use server";

import { createHash } from "node:crypto";
import type { LabelEvalDomain } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit";
import { getAvScanner } from "@/lib/av";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { parseSfdaWorkbook, SchemaContractError } from "@/server/label-eval/kb/sfda-parser";
import { parseCosmeticsWorkbooks } from "@/server/label-eval/kb/cosmetics-parser";
import { activateKbVersion, createDraftKbVersion, diffAgainstActive, type KbDiffResult } from "@/server/label-eval/kb/versioning";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const MAX_UPLOAD_MB = 15;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** ZIP local-file-header signature — xlsx is a zip container; ExcelJS's own parse is the real validator. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function isDomain(v: unknown): v is LabelEvalDomain {
  return v === "SFDA_SUPPLEMENTS" || v === "COSMETICS";
}

type FileValidation = { ok: true; buffer: Buffer } | { ok: false; error: string };

/** Shared MIME/size/zip-magic validation — the real parse is what actually decides if the content is legitimate xlsx, same as before. */
async function validateXlsxFile(file: unknown): Promise<FileValidation> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "NO_FILE" };
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: "FILE_TOO_LARGE" };
  if (file.type !== XLSX_MIME && !file.name.toLowerCase().endsWith(".xlsx")) {
    return { ok: false, error: "MIME_REJECTED" };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!ZIP_MAGIC.every((b, i) => buffer[i] === b)) {
    return { ok: false, error: "MIME_REJECTED" };
  }
  const verdict = await getAvScanner().scan(buffer);
  if (verdict === "INFECTED") return { ok: false, error: "INFECTED_FILE" };
  return { ok: true, buffer };
}

export async function uploadKbWorkbook(formData: FormData): Promise<
  ActionResult<{ versionId: string; diff: KbDiffResult; warnings: string[] }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const domain = formData.get("domain");
    if (!isDomain(domain)) return { ok: false, error: "VALIDATION" };

    let bundle;
    let checksum: string;
    let sourceFilename: string;

    if (domain === "COSMETICS") {
      // Cosmetics needs both source workbooks together to form one usable
      // dataset (label rules alone can't assess ingredients or claims), so
      // one upload always replaces the domain's complete rule set.
      const regFile = formData.get("file");
      const claimsFile = formData.get("claimsFile");
      if (!(regFile instanceof File) || !(claimsFile instanceof File)) return { ok: false, error: "NO_FILE" };

      const regValidation = await validateXlsxFile(regFile);
      if (!regValidation.ok) return { ok: false, error: regValidation.error };
      const claimsValidation = await validateXlsxFile(claimsFile);
      if (!claimsValidation.ok) return { ok: false, error: claimsValidation.error };

      try {
        bundle = await parseCosmeticsWorkbooks(regValidation.buffer, claimsValidation.buffer);
      } catch (e) {
        if (e instanceof SchemaContractError) {
          return { ok: false, error: `SCHEMA_CONTRACT_VIOLATION:${e.message}` };
        }
        return { ok: false, error: "PARSE_FAILED" };
      }

      checksum = createHash("sha256")
        .update(regValidation.buffer)
        .update(claimsValidation.buffer)
        .digest("hex");
      sourceFilename = `${regFile.name} + ${claimsFile.name}`;
    } else {
      const file = formData.get("file");
      const validation = await validateXlsxFile(file);
      if (!validation.ok) return { ok: false, error: validation.error };

      try {
        bundle = await parseSfdaWorkbook(validation.buffer);
      } catch (e) {
        if (e instanceof SchemaContractError) {
          return { ok: false, error: `SCHEMA_CONTRACT_VIOLATION:${e.message}` };
        }
        return { ok: false, error: "PARSE_FAILED" };
      }

      checksum = createHash("sha256").update(validation.buffer).digest("hex");
      sourceFilename = file instanceof File ? file.name : "";
    }

    const dup = await prisma.labelKbVersion.findFirst({ where: { domain, checksum } });
    if (dup) return { ok: false, error: `DUPLICATE_UPLOAD:${dup.versionLabel}` };

    const versionLabel = `${domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}_kb_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const created = await createDraftKbVersion({
      domain,
      versionLabel,
      sourceFilename,
      uploadedByUserId: session.id,
      checksum,
      bundle,
    });

    const diff = await diffAgainstActive(domain, created.id);

    await writeAuditLog({
      session,
      action: "label_eval.kb.upload",
      entityType: "LabelKbVersion",
      entityId: created.id,
      after: { domain, versionLabel, ruleCount: bundle.rules.length, lookupCount: bundle.lookups.length },
    });

    revalidatePath("/[locale]/admin/label-evaluator/[domain]/datasets", "page");

    return { ok: true, data: { versionId: created.id, diff, warnings: bundle.warnings } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    return { ok: false, error: "UPLOAD_FAILED" };
  }
}

export async function activateKbWorkbook(input: { versionId: string; domain: LabelEvalDomain }): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const before = await prisma.labelKbVersion.findFirst({ where: { domain: input.domain, status: "ACTIVE" } });
    await activateKbVersion(input.domain, input.versionId, session.id);

    await writeAuditLog({
      session,
      action: "label_eval.kb.activate",
      entityType: "LabelKbVersion",
      entityId: input.versionId,
      before: before ? { previousActiveVersionId: before.id, versionLabel: before.versionLabel } : undefined,
    });

    revalidatePath("/[locale]/admin/label-evaluator/[domain]/datasets", "page");
    revalidatePath("/[locale]/admin/label-evaluator/sfda", "page");
    revalidatePath("/[locale]/admin/label-evaluator/cosmetics", "page");

    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") return { ok: false, error: message };
    if (message === "DOMAIN_MISMATCH") return { ok: false, error: "DOMAIN_MISMATCH" };
    return { ok: false, error: "ACTIVATE_FAILED" };
  }
}

/** Rollback is the same mechanic as activation — reactivating an archived version (design doc §7.3). */
export const rollbackKbWorkbook = activateKbWorkbook;
