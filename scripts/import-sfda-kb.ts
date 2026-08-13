/**
 * One-time / repeatable SFDA Label Evaluator KB import from an .xlsx file.
 * Bypasses the admin-UI upload action (which needs a real HTTP session) —
 * this is a trusted operator script, same trust level as prisma/seed.ts.
 *
 *   npx tsx scripts/import-sfda-kb.ts <path-to-workbook.xlsx> [--activate] [--force]
 *
 * --force bypasses the checksum-dedup check — needed when re-importing the
 * SAME workbook file after a parser/classification code change, since the
 * file bytes (and therefore checksum) haven't changed even though the
 * parsed output has.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/db";
import { parseSfdaWorkbook, SchemaContractError } from "../src/server/label-eval/kb/sfda-parser";
import { createDraftKbVersion, diffAgainstActive, activateKbVersion } from "../src/server/label-eval/kb/versioning";

async function main() {
  const filePath = process.argv[2];
  const shouldActivate = process.argv.includes("--activate");
  const force = process.argv.includes("--force");
  if (!filePath) {
    console.error("Usage: npx tsx scripts/import-sfda-kb.ts <path-to-workbook.xlsx> [--activate] [--force]");
    process.exit(1);
  }

  const buffer = await readFile(filePath);
  const checksum = createHash("sha256").update(buffer).digest("hex");

  const dup = await prisma.labelKbVersion.findFirst({ where: { domain: "SFDA_SUPPLEMENTS", checksum } });
  if (dup && !force) {
    console.log(`Already imported as ${dup.versionLabel} (status ${dup.status}, id ${dup.id}). Nothing to do. Pass --force to re-import anyway (e.g. after a parser code change).`);
    return;
  }

  let bundle;
  try {
    bundle = await parseSfdaWorkbook(buffer);
  } catch (e) {
    if (e instanceof SchemaContractError) {
      console.error("Schema contract violation — refusing to import:", e.message);
      process.exit(1);
    }
    throw e;
  }

  console.log(`Parsed ${bundle.rules.length} rules, ${bundle.lookups.length} lookup records.`);
  if (bundle.warnings.length) {
    console.log("Warnings:");
    bundle.warnings.forEach((w) => console.log(" -", w));
  }

  const systemAdmin = await prisma.user.findFirst({
    where: { roles: { some: { role: "SYSTEM_ADMIN" } } },
  });
  if (!systemAdmin) {
    console.error("No SYSTEM_ADMIN user found to attribute this import to.");
    process.exit(1);
  }

  const versionLabel = `sfda_kb_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const created = await createDraftKbVersion({
    domain: "SFDA_SUPPLEMENTS",
    versionLabel,
    sourceFilename: filePath.split("/").pop() ?? filePath,
    uploadedByUserId: systemAdmin.id,
    checksum,
    bundle,
  });
  console.log(`Created DRAFT version ${versionLabel} (${created.id}).`);

  const diff = await diffAgainstActive("SFDA_SUPPLEMENTS", created.id);
  console.log("Diff vs. current ACTIVE:", diff);

  if (shouldActivate) {
    await activateKbVersion("SFDA_SUPPLEMENTS", created.id, systemAdmin.id);
    console.log(`Activated ${versionLabel} as the ACTIVE SFDA_SUPPLEMENTS dataset.`);
  } else {
    console.log("Left as DRAFT. Re-run with --activate, or activate from the admin UI, to make it live.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
