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

export async function uploadKbWorkbook(formData: FormData): Promise<
  ActionResult<{ versionId: string; diff: KbDiffResult; warnings: string[] }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const domain = formData.get("domain");
    if (!isDomain(domain)) return { ok: false, error: "VALIDATION" };

    if (domain === "COSMETICS") {
      // Design doc §7.2/§14: no cosmetics parser has been built against the
      // real workbook yet. A guessed schema could silently accept or reject
      // the real file wrong — refuse cleanly instead of pretending to parse it.
      return { ok: false, error: "COSMETICS_SCHEMA_NOT_YET_CONFIRMED" };
    }

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "NO_FILE" };
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: "FILE_TOO_LARGE" };
    if (
      file.type !== XLSX_MIME &&
      !file.name.toLowerCase().endsWith(".xlsx")
    ) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!ZIP_MAGIC.every((b, i) => buffer[i] === b)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") return { ok: false, error: "INFECTED_FILE" };

    let bundle;
    try {
      bundle = await parseSfdaWorkbook(buffer);
    } catch (e) {
      if (e instanceof SchemaContractError) {
        return { ok: false, error: `SCHEMA_CONTRACT_VIOLATION:${e.message}` };
      }
      return { ok: false, error: "PARSE_FAILED" };
    }

    const checksum = createHash("sha256").update(buffer).digest("hex");
    const dup = await prisma.labelKbVersion.findFirst({ where: { domain, checksum } });
    if (dup) return { ok: false, error: `DUPLICATE_UPLOAD:${dup.versionLabel}` };

    const versionLabel = `${domain === "SFDA_SUPPLEMENTS" ? "sfda" : "cosmetics"}_kb_${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const created = await createDraftKbVersion({
      domain,
      versionLabel,
      sourceFilename: file.name,
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
