import type { LabelEvalDomain } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ParsedKbLookup, ParsedKbRule } from "@/server/label-eval/kb/sfda-parser";

/** Domain-generic — a cosmetics parser will produce the same bundle shape. */
export type ParsedKbBundle = {
  rules: ParsedKbRule[];
  lookups: ParsedKbLookup[];
  categories?: { code: string; nameEn: string; nameAr: string; icon?: string; properties?: unknown[]; sortOrder?: number }[];
  warnings: string[];
};

export type KbDiffResult = {
  addedCodes: string[];
  removedCodes: string[];
  changedCodes: string[];
  unchangedCount: number;
  lookupCountBefore: number;
  lookupCountAfter: number;
};

/**
 * Creates a DRAFT LabelKbVersion from a parsed bundle. Does not touch ACTIVE
 * status — activation is a separate, explicit step (design doc §7.3).
 */
export async function createDraftKbVersion(input: {
  domain: LabelEvalDomain;
  versionLabel: string;
  sourceFilename: string;
  uploadedByUserId: string;
  checksum: string;
  bundle: ParsedKbBundle;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const version = await tx.labelKbVersion.create({
      data: {
        domain: input.domain,
        versionLabel: input.versionLabel,
        sourceFilename: input.sourceFilename,
        uploadedByUserId: input.uploadedByUserId,
        checksum: input.checksum,
        notes: input.bundle.warnings.length ? input.bundle.warnings.join("\n") : null,
      },
    });

    await tx.labelKbRule.createMany({
      data: input.bundle.rules.map((r) => ({
        kbVersionId: version.id,
        domain: input.domain,
        ruleType: r.ruleType,
        code: r.code,
        section: r.section,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
        priority: r.priority,
        evaluatorKey: r.evaluatorKey,
        autoVerifiable: r.autoVerifiable,
        payload: r.payload as never,
      })),
    });

    if (input.bundle.lookups.length > 0) {
      await tx.labelKbLookup.createMany({
        data: input.bundle.lookups.map((l) => ({
          kbVersionId: version.id,
          domain: input.domain,
          tableKey: l.tableKey,
          payload: l.payload as never,
        })),
      });
    }

    if (input.bundle.categories?.length) {
      await tx.labelKbCategory.createMany({
        data: input.bundle.categories.map((c, i) => ({
          kbVersionId: version.id,
          domain: input.domain,
          code: c.code,
          nameEn: c.nameEn,
          nameAr: c.nameAr,
          icon: c.icon,
          properties: (c.properties ?? []) as never,
          sortOrder: c.sortOrder ?? i,
        })),
      });
    }

    return { id: version.id };
  });
}

/**
 * Deterministic JSON stringify — sorts object keys recursively so two
 * semantically identical payloads always compare equal regardless of
 * property order. Needed because Postgres jsonb does not preserve object key
 * order on round-trip (the same gotcha already hit once in this codebase —
 * see attr-schema.ts's `sortOrder` comment): a plain `JSON.stringify`
 * comparison would report a rule as "changed" purely because jsonb happened
 * to return its payload keys in a different order, not because anything
 * about the rule actually changed.
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Diffs a DRAFT version's rule codes against the domain's current ACTIVE version, if any. */
export async function diffAgainstActive(domain: LabelEvalDomain, draftVersionId: string): Promise<KbDiffResult> {
  const [draftRules, active] = await Promise.all([
    prisma.labelKbRule.findMany({ where: { kbVersionId: draftVersionId }, select: { code: true, payload: true } }),
    prisma.labelKbVersion.findFirst({ where: { domain, status: "ACTIVE" } }),
  ]);

  if (!active) {
    return {
      addedCodes: draftRules.map((r) => r.code),
      removedCodes: [],
      changedCodes: [],
      unchangedCount: 0,
      lookupCountBefore: 0,
      lookupCountAfter: await prisma.labelKbLookup.count({ where: { kbVersionId: draftVersionId } }),
    };
  }

  const activeRules = await prisma.labelKbRule.findMany({
    where: { kbVersionId: active.id },
    select: { code: true, payload: true },
  });
  const activeByCode = new Map(activeRules.map((r) => [r.code, r]));
  const draftByCode = new Map(draftRules.map((r) => [r.code, r]));

  const addedCodes = [...draftByCode.keys()].filter((c) => !activeByCode.has(c));
  const removedCodes = [...activeByCode.keys()].filter((c) => !draftByCode.has(c));
  const changedCodes = [...draftByCode.keys()].filter((c) => {
    const prev = activeByCode.get(c);
    if (!prev) return false;
    return stableStringify(prev.payload) !== stableStringify(draftByCode.get(c)!.payload);
  });

  const [lookupCountBefore, lookupCountAfter] = await Promise.all([
    prisma.labelKbLookup.count({ where: { kbVersionId: active.id } }),
    prisma.labelKbLookup.count({ where: { kbVersionId: draftVersionId } }),
  ]);

  return {
    addedCodes,
    removedCodes,
    changedCodes,
    unchangedCount: draftByCode.size - addedCodes.length - changedCodes.length,
    lookupCountBefore,
    lookupCountAfter,
  };
}

/**
 * Atomic activation (design doc §7.3): DRAFT -> ACTIVE, the domain's prior
 * ACTIVE -> ARCHIVED. Past LabelAssessment rows keep their stamped
 * kbVersionId forever (no FK from LabelAssessment back here is ever
 * updated) — activating a new version never retroactively rescopes a
 * historical assessment.
 */
export async function activateKbVersion(domain: LabelEvalDomain, versionId: string, activatedByUserId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const target = await tx.labelKbVersion.findUniqueOrThrow({ where: { id: versionId } });
    if (target.domain !== domain) throw new Error("DOMAIN_MISMATCH");

    await tx.labelKbVersion.updateMany({
      where: { domain, status: "ACTIVE" },
      data: { status: "ARCHIVED" },
    });
    await tx.labelKbVersion.update({
      where: { id: versionId },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedByUserId },
    });
  });
}
