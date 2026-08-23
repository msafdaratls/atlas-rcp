import type { LabelEvalDomain, LabelKbRule } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Human-readable regulatory text keys we know appear in LabelKbRule.payload
 * across both KB parsers (sfda-parser.ts / cosmetics-parser.ts). Deliberately
 * an allowlist, not a denylist: payload also carries internal routing/matching
 * fields (fieldKey, matchMode, triggerKeywords, ...) that describe how the
 * automated checker works rather than what the regulation requires — those
 * never reach the client-facing assistant, allowlisted-in fields do.
 */
const SAFE_PAYLOAD_KEYS = [
  "compliantWhen",
  "decisionRule",
  "referenceRange",
  "applicability",
  "nonConformities",
  "commonNonConformities",
  "evidenceRequired",
  "explanation",
  "regulatoryRequirement",
  "regulatoryReason",
  "requiredScientificEvidence",
  "regulatoryStatus",
  "regulatoryClassification",
  "restrictedBodyAreas",
  "restrictedUserGroups",
  "conditionsOfUse",
  "requiredWarningStatements",
  "maxConcentration",
  "annexReference",
  "casNumber",
  "ecNumber",
  "ingredient",
  "applicableCategories",
  "reasonEn",
  "triggerSource",
  "productCategory",
  "productSubcategory",
  "claimType",
] as const;

function safePayloadText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return SAFE_PAYLOAD_KEYS.map((key) => {
    const value = record[key];
    return typeof value === "string" && value.trim() ? `${key}: ${value.trim()}` : null;
  })
    .filter((v): v is string => v !== null)
    .join("\n");
}

/** One rule rendered as text a client can read, with no internal fields. */
export function formatRuleForClient(rule: LabelKbRule): string {
  const header = `[${rule.code}]${rule.section ? ` (${rule.section})` : ""} ${rule.titleEn ?? rule.titleAr} / ${rule.titleAr}`;
  const body = safePayloadText(rule.payload);
  return body ? `${header}\n${body}` : header;
}

const STOPWORDS = new Set([
  "what", "does", "which", "clause", "rule", "rules", "about", "the", "for", "with", "this", "that", "have", "must", "need",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Pure ranking logic — no DB — kept separate so it's directly unit-testable. */
export function matchRules(rules: LabelKbRule[], query: string, limit = 8): LabelKbRule[] {
  const words = tokenize(query);
  if (words.length === 0) return rules.slice(0, limit);

  const scored = rules.map((rule) => {
    const haystack = `${rule.titleEn ?? ""} ${rule.titleAr} ${rule.section ?? ""} ${rule.code} ${safePayloadText(rule.payload)}`.toLowerCase();
    const score = words.reduce((acc, w) => acc + (haystack.includes(w) ? 1 : 0), 0);
    return { rule, score };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return (matched.length > 0 ? matched : scored).slice(0, limit).map((s) => s.rule);
}

/**
 * Only ever reads from the currently ACTIVE KB version per domain (never
 * DRAFT/ARCHIVED) so callers are told the rule Atlas actually evaluates
 * against today. Shared by the AI tool below and by regulatory-lookup.ts's
 * no-AI direct-answer path.
 */
export async function loadActiveKbRules(domain?: LabelEvalDomain): Promise<{ hasActiveVersion: boolean; rules: LabelKbRule[] }> {
  const domains: LabelEvalDomain[] = domain ? [domain] : ["SFDA_SUPPLEMENTS", "COSMETICS"];
  const versions = await prisma.labelKbVersion.findMany({
    where: { domain: { in: domains }, status: "ACTIVE" },
    select: { id: true },
  });
  if (versions.length === 0) return { hasActiveVersion: false, rules: [] };
  const rules = await prisma.labelKbRule.findMany({ where: { kbVersionId: { in: versions.map((v) => v.id) } } });
  return { hasActiveVersion: true, rules };
}

/**
 * True when at least one rule's title/section/code/payload text genuinely
 * overlaps a word of the query — i.e. matchRules would return a real match
 * rather than its "nothing scored, here's some rules anyway" fallback.
 * regulatory-lookup.ts needs this distinction: showing that fallback as a
 * confident direct answer (no AI to judge relevance) would be misleading.
 */
export function hasRuleMatch(rules: LabelKbRule[], query: string): boolean {
  const words = tokenize(query);
  if (words.length === 0) return false;
  return rules.some((rule) => {
    const haystack = `${rule.titleEn ?? ""} ${rule.titleAr} ${rule.section ?? ""} ${rule.code} ${safePayloadText(rule.payload)}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  });
}

/** Backs the assistant's `search_regulatory_rules` tool (used when the AI path is asked to look something up). */
export async function searchKbRules(query: string, domain?: LabelEvalDomain): Promise<string> {
  const { hasActiveVersion, rules } = await loadActiveKbRules(domain);
  if (!hasActiveVersion) {
    return "No active knowledge-base version is loaded for this domain yet — tell the client to contact support for the specific clause text.";
  }
  const top = matchRules(rules, query);
  if (top.length === 0) {
    return "No matching rule was found in the active knowledge base for that query.";
  }
  return top.map(formatRuleForClient).join("\n\n");
}
