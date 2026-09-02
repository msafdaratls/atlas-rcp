import type { RequiredDocument, ServiceItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { describeActivities, describeDocuments } from "@/server/assistant/catalogue-context";

type ServiceWithDocuments = ServiceItem & { requiredDocuments: RequiredDocument[] };

const STOPWORDS = new Set([
  "what", "whats", "does", "which", "how", "much", "long", "many", "for", "the", "a", "an",
  "is", "are", "do", "need", "needs", "needed", "with", "about", "this", "that", "and",
  "of", "to", "in", "on", "me", "my", "i", "want", "would", "like", "get", "can", "you",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Finds the one active service the message is unambiguously about, by
 * keyword overlap against its name/code/deliverable — pure logic, no DB,
 * kept separate so it's directly unit-testable (mirrors kb-search's
 * matchRules split). Zero matches, or a tie between two services (e.g. two
 * different services both named "... SCOC"), returns null so the caller
 * falls through to the AI rather than guessing which one was meant.
 */
export function matchService<T extends ServiceWithDocuments>(services: T[], query: string): T | null {
  const words = tokenize(query);
  if (words.length === 0) return null;

  let best: { service: T; score: number } | null = null;
  let tied = false;
  for (const service of services) {
    const haystack = `${service.nameEn} ${service.nameAr} ${service.code} ${service.deliverableEn ?? ""}`.toLowerCase();
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { service, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  return best.service;
}

async function loadActiveServices(): Promise<ServiceWithDocuments[]> {
  return prisma.serviceItem.findMany({
    where: { active: true },
    include: { requiredDocuments: { orderBy: { sortOrder: "asc" } } },
  });
}

/**
 * Renders one service's price/SLA/documents/activities straight from its DB
 * row — no AI call, so it can never go stale or invent a figure. This is
 * the deterministic answer to "what documents/price/SLA for <service>"
 * questions; the AI path (system-prompt.ts) exists only for messages this
 * can't confidently resolve to one service.
 */
export function formatServiceForClient(item: ServiceWithDocuments, locale: string): string {
  const deliverable = item.deliverableEn || item.nameEn;
  const deliverableAr = item.deliverableAr || item.nameAr;

  if (locale === "ar") {
    return (
      `**${item.nameAr}** (${item.code})\n` +
      `المخرج: ${deliverableAr}\n` +
      `مدة الإنجاز: ${item.slaHours} ساعة\n` +
      `أنشطة التقييم: ${describeActivities(item)}\n` +
      `المستندات المطلوبة: ${describeDocuments(item.requiredDocuments)}`
    );
  }
  return (
    `**${item.nameEn}** (${item.code})\n` +
    `Produces: ${deliverable}\n` +
    `SLA: ${item.slaHours} hours\n` +
    `Evaluation activities: ${describeActivities(item)}\n` +
    `Required documents: ${describeDocuments(item.requiredDocuments)}`
  );
}

/** Full lookup: query the live catalogue, match the message to one service, render it — or null if nothing confident matched. */
export async function findServiceAnswer(text: string, locale: string): Promise<string | null> {
  const services = await loadActiveServices();
  const match = matchService(services, text);
  return match ? formatServiceForClient(match, locale) : null;
}
