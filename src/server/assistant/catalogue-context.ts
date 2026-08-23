import { prisma } from "@/lib/db";
import { parseCheckSets } from "@/lib/assessment";

/** The catalogue changes rarely (admin-edited) — one chat turn is not worth a fresh multi-level query. */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { text: string; expiresAt: number } | null = null;

/**
 * Renders the full active service catalogue as plain text, scoped to fields
 * a client already sees elsewhere in the product (catalogue cards, the new
 * request wizard's price/SLA line) — nothing here is a step beyond what's
 * already client-visible. Fed into the assistant's system prompt so "what do
 * I need for X" and "how much does X cost" answers come from the real
 * catalogue instead of the model's own guess.
 */
export async function buildCatalogueContext(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.text;
  const text = await queryCatalogueContext();
  cache = { text, expiresAt: Date.now() + CACHE_TTL_MS };
  return text;
}

async function queryCatalogueContext(): Promise<string> {
  const mainCategories = await prisma.mainCategory.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: {
      subCategories: {
        where: { active: true },
        orderBy: { sortOrder: "asc" },
        include: {
          serviceItems: {
            where: { active: true },
            orderBy: { sortOrder: "asc" },
            include: {
              requiredDocuments: { orderBy: { sortOrder: "asc" } },
            },
          },
        },
      },
    },
  });

  const lines: string[] = [];
  for (const main of mainCategories) {
    if (main.subCategories.every((sub) => sub.serviceItems.length === 0)) continue;
    lines.push(`## ${main.nameEn} / ${main.nameAr}`);
    for (const sub of main.subCategories) {
      if (sub.serviceItems.length === 0) continue;
      lines.push(`### ${sub.nameEn} / ${sub.nameAr}`);
      for (const item of sub.serviceItems) {
        const deliverable = item.deliverableEn || item.nameEn;
        const vat = Number(item.basePrice) * Number(item.vatRate);
        const total = Number(item.basePrice) + vat;
        lines.push(
          `- SERVICE "${item.nameEn}" / "${item.nameAr}" (code ${item.code})\n` +
            `  Produces: ${deliverable}${item.deliverableAr ? ` / ${item.deliverableAr}` : ""}\n` +
            `  Description: ${item.descEn ?? "—"}\n` +
            `  Price: ${Number(item.basePrice).toFixed(2)} SAR + VAT = ${total.toFixed(2)} SAR total. SLA: ${item.slaHours} hours.\n` +
            `  Resubmissions: ${item.freeResubmissions} free, up to ${item.maxResubmissions} total (each extra resubmission billed at ${(Number(item.resubmissionPricePct) * 100).toFixed(0)}% of the base price).\n` +
            `  Evaluation activities involved: ${describeActivities(item)}\n` +
            `  Required documents: ${describeDocuments(item.requiredDocuments)}\n` +
            `  What we check: ${describeCheckSets(item.checkSets)}`,
        );
      }
    }
  }
  return lines.join("\n\n");
}

/** Also used by service-lookup.ts to render one service's activities without an AI call. */
export function describeActivities(item: {
  requiresInspection: boolean;
  requiresLabTesting: boolean;
  requiresFactoryAudit: boolean;
}): string {
  const activities = [
    item.requiresInspection && "site inspection",
    item.requiresLabTesting && "lab testing",
    item.requiresFactoryAudit && "factory audit",
  ].filter(Boolean);
  return activities.length > 0 ? activities.join(", ") : "none beyond document review";
}

/** Also used by service-lookup.ts to render one service's documents without an AI call. */
export function describeDocuments(
  docs: { nameEn: string; nameAr: string; mandatory: boolean; helpEn: string | null }[],
): string {
  if (docs.length === 0) return "none listed";
  return docs
    .map((d) => `${d.nameEn} / ${d.nameAr}${d.mandatory ? "" : " (optional)"}${d.helpEn ? ` — ${d.helpEn}` : ""}`)
    .join("; ");
}

function describeCheckSets(raw: unknown): string {
  const sets = parseCheckSets(raw);
  if (sets.length === 0) return "not itemized in the catalogue";
  return sets.map((s) => s.titleEn).join("; ");
}
