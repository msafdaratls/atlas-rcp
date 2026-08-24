/**
 * Installs the blank downloadable forms clients fill in before uploading a
 * completed document (SAB-001's Supplier / Manufacturer declarations today).
 *
 * Runs in two places:
 *   - `prisma/seed.ts`, so a freshly seeded dev DB has the forms; and
 *   - `npm run db:templates` in production, where `db:seed` is never run and
 *     `prisma migrate deploy` cannot copy bytes into the storage volume.
 *
 * Idempotent: a slot whose stored template already matches the asset byte for
 * byte is left alone, so re-running is free. Dropping a new revision of a form
 * into `seed-assets/document-templates/` and re-running replaces it in place
 * and deletes the superseded object.
 *
 * Lives under `prisma/` rather than `scripts/` because the Dockerfile copies
 * `/app/prisma` into the runtime image and `scripts/` is not shipped.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ASSET_DIR = path.join(
  process.cwd(),
  "prisma",
  "seed-assets",
  "document-templates",
);

/**
 * Keyed by RequiredDocument.code. `serviceItemCode` scopes each form to the
 * service that asks for it — codes are only unique per service item, so a
 * future service reusing RISK_ASSESSMENT will not silently inherit this file.
 */
const TEMPLATES: {
  serviceItemCode: string;
  documentCode: string;
  assetFile: string;
  downloadName: string;
}[] = [
  {
    serviceItemCode: "SAB-001",
    documentCode: "IMPORTER_DECLARATION",
    assetFile: "supplier-declaration-of-conformity.docx",
    downloadName: "Supplier Declaration of Conformity.docx",
  },
  {
    serviceItemCode: "SAB-001",
    documentCode: "MANUFACTURER_DECLARATION",
    assetFile: "manufacturer-declaration-of-conformity.docx",
    downloadName: "Manufacturer Declaration of Conformity.docx",
  },
];

/**
 * Document slots whose blank form depends on a product attribute. Each variant
 * key must match a value of the enum named by `variantAttrKey` in the service
 * item's productAttrSchema — install() fails loudly on a key that does not,
 * because a typo would silently leave clients with no downloadable form.
 *
 * Asset files are named after the variant key (TEXTILE.docx …) so the mapping
 * is checkable at a glance against the schema enum.
 */
const VARIANT_TEMPLATES: {
  serviceItemCode: string;
  documentCode: string;
  variantAttrKey: string;
  assetDir: string;
  /** Download name shown to the client; {label} is replaced by the variant key. */
  downloadNameFor: (variantKey: string) => string;
  variantKeys: string[];
}[] = [
  {
    serviceItemCode: "SAB-001",
    documentCode: "RISK_ASSESSMENT",
    variantAttrKey: "technical_regulation",
    assetDir: "risk-assessment",
    downloadNameFor: (key) =>
      `Risk Assessment - ${key.toLowerCase().replace(/_/g, " ")}.docx`,
    // One per SABER technical regulation. Kept in the same order as the
    // productAttrSchema enum so the two lists can be diffed by eye.
    variantKeys: [
      "TEXTILE",
      "ORNAMENTS_ACCESSORIES",
      "PAPER_CARDBOARD",
      "PACKAGING",
      "MACHINERY_SAFETY",
      "KITCHEN_TOOLS_FOOD_SAFETY",
      "ICT_DEVICES",
      "BUILDING_MATERIALS_PART5",
      "BUILDING_MATERIALS_PART4",
      "BUILDING_MATERIALS_PART1",
      "LOW_VOLTAGE_ELECTRICAL",
      "AUTO_SPARE_PARTS",
    ],
  },
];

export type TemplateInstallResult = {
  documentCode: string;
  variantKey?: string;
  status: "installed" | "replaced" | "unchanged" | "missing-slot";
};

/**
 * Reads the allowed values of `attrKey` out of a service item's
 * productAttrSchema, so variant keys can be validated against the same enum
 * the client's product form offers. Returns null when the attribute has no
 * enum (nothing to check against).
 */
function schemaEnumValues(
  productAttrSchema: unknown,
  attrKey: string,
): string[] | null {
  if (!productAttrSchema || typeof productAttrSchema !== "object") return null;
  const props = (productAttrSchema as Record<string, unknown>).properties;
  if (!props || typeof props !== "object") return null;
  const field = (props as Record<string, unknown>)[attrKey];
  if (!field || typeof field !== "object") return null;
  const values = (field as Record<string, unknown>).enum;
  if (!Array.isArray(values)) return null;
  return values.filter((v): v is string => typeof v === "string");
}

export async function installDocumentTemplates(
  prisma: PrismaClient,
): Promise<TemplateInstallResult[]> {
  // Imported lazily so seeding a DB without a configured storage driver only
  // fails if there is actually a template to write.
  const { storage } = await import("../src/lib/storage");
  const results: TemplateInstallResult[] = [];

  for (const template of TEMPLATES) {
    const slot = await prisma.requiredDocument.findFirst({
      where: {
        code: template.documentCode,
        serviceItem: { code: template.serviceItemCode },
      },
      select: { id: true, templateStorageKey: true },
    });

    if (!slot) {
      results.push({ documentCode: template.documentCode, status: "missing-slot" });
      continue;
    }

    const body = await readFile(path.join(ASSET_DIR, template.assetFile));

    if (slot.templateStorageKey) {
      const current = await storage.get(slot.templateStorageKey);
      if (current && current.body.equals(body)) {
        results.push({ documentCode: template.documentCode, status: "unchanged" });
        continue;
      }
    }

    const stored = await storage.put({
      keyPrefix: `templates/service-documents/${template.serviceItemCode}`,
      fileName: template.downloadName,
      mimeType: DOCX_MIME,
      body,
    });

    const previousKey = slot.templateStorageKey;
    await prisma.requiredDocument.update({
      where: { id: slot.id },
      data: {
        templateStorageKey: stored.key,
        templateFileName: template.downloadName,
        templateMimeType: DOCX_MIME,
      },
    });

    // Only after the row points at the new object, so a crash mid-way leaves a
    // downloadable template rather than a dangling key.
    if (previousKey) await storage.delete(previousKey);

    results.push({
      documentCode: template.documentCode,
      status: previousKey ? "replaced" : "installed",
    });
  }

  for (const set of VARIANT_TEMPLATES) {
    const slot = await prisma.requiredDocument.findFirst({
      where: {
        code: set.documentCode,
        serviceItem: { code: set.serviceItemCode },
      },
      select: {
        id: true,
        templateVariantAttrKey: true,
        serviceItem: { select: { productAttrSchema: true } },
        templates: {
          select: { id: true, variantKey: true, storageKey: true },
        },
      },
    });

    if (!slot) {
      results.push({ documentCode: set.documentCode, status: "missing-slot" });
      continue;
    }

    // A variant key that is not an allowed value of the attribute can never be
    // matched by a real product, so the form would be dead weight. Fail loudly
    // rather than installing something no client will ever be offered.
    const allowed = schemaEnumValues(
      slot.serviceItem.productAttrSchema,
      set.variantAttrKey,
    );
    if (allowed) {
      const unknown = set.variantKeys.filter((k) => !allowed.includes(k));
      if (unknown.length > 0) {
        throw new Error(
          `${set.serviceItemCode}/${set.documentCode}: variant key(s) ${unknown.join(", ")} are not values of "${set.variantAttrKey}" — add them to the productAttrSchema enum first.`,
        );
      }
    }

    if (slot.templateVariantAttrKey !== set.variantAttrKey) {
      await prisma.requiredDocument.update({
        where: { id: slot.id },
        data: { templateVariantAttrKey: set.variantAttrKey },
      });
    }

    const existingByKey = new Map(slot.templates.map((t) => [t.variantKey, t]));

    for (const [index, variantKey] of set.variantKeys.entries()) {
      const body = await readFile(
        path.join(ASSET_DIR, set.assetDir, `${variantKey}.docx`),
      );
      const downloadName = set.downloadNameFor(variantKey);
      const existing = existingByKey.get(variantKey);

      if (existing) {
        const current = await storage.get(existing.storageKey);
        if (current && current.body.equals(body)) {
          results.push({
            documentCode: set.documentCode,
            variantKey,
            status: "unchanged",
          });
          continue;
        }
      }

      const stored = await storage.put({
        keyPrefix: `templates/service-documents/${set.serviceItemCode}/${set.documentCode}`,
        fileName: downloadName,
        mimeType: DOCX_MIME,
        body,
      });

      await prisma.requiredDocumentTemplate.upsert({
        where: {
          requiredDocumentId_variantKey: {
            requiredDocumentId: slot.id,
            variantKey,
          },
        },
        create: {
          requiredDocumentId: slot.id,
          variantKey,
          storageKey: stored.key,
          fileName: downloadName,
          mimeType: DOCX_MIME,
          sortOrder: index,
        },
        update: {
          storageKey: stored.key,
          fileName: downloadName,
          mimeType: DOCX_MIME,
          sortOrder: index,
        },
      });

      if (existing) await storage.delete(existing.storageKey);

      results.push({
        documentCode: set.documentCode,
        variantKey,
        status: existing ? "replaced" : "installed",
      });
    }
  }

  return results;
}

/** CLI entry: `npm run db:templates`. */
async function main() {
  const { PrismaClient: Client } = await import("@prisma/client");
  const prisma = new Client();
  try {
    const results = await installDocumentTemplates(prisma);
    for (const r of results) {
      const name = r.variantKey ? `${r.documentCode}/${r.variantKey}` : r.documentCode;
      process.stdout.write(`${name}: ${r.status}\n`);
    }
    if (results.some((r) => r.status === "missing-slot")) {
      throw new Error(
        "One or more required-document slots were not found — run migrations first.",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Only self-execute when run directly, not when imported by the seed.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
