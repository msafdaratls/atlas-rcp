import { formatRuleForClient, hasRuleMatch, loadActiveKbRules, matchRules } from "@/server/assistant/kb-search";

/**
 * Cheap pre-check so a plain "how do I..." platform question never triggers
 * two extra DB queries (loadActiveKbRules below) for nothing — only
 * messages that plausibly ask about a clause/standard attempt the KB match.
 */
const REGULATORY_SIGNAL_WORDS = [
  "clause", "standard", "regulation", "regulatory", "requirement", "compliant", "compliance",
  "restrict", "banned", "allowed", "warning statement", "allergen", "ingredient", "net weight",
  "concentration", "nickel", "fragrance", "gso", "sfda", "saso",
  "بند", "معيار", "تنظيم", "متطلب", "مطابق", "مسموح", "محظور", "تحذير", "مكون", "تركيز", "الوزن الصافي",
];

export function looksRegulatory(text: string): boolean {
  const normalized = text.toLowerCase();
  return REGULATORY_SIGNAL_WORDS.some((w) => normalized.includes(w));
}

/**
 * Direct, no-AI answer for a clause/standard question: the KB search the
 * assistant's AI tool already uses, minus the AI — the matched rule text is
 * shown as-is (it's already written to be client-safe, see kb-search.ts's
 * SAFE_PAYLOAD_KEYS allowlist). Only returns something on a genuine keyword
 * match (hasRuleMatch), never matchRules' "nothing scored, here's some rules
 * anyway" fallback, since there's no AI here to judge relevance.
 */
export async function findRegulatoryAnswer(text: string, locale: string): Promise<string | null> {
  if (!looksRegulatory(text)) return null;

  const { rules } = await loadActiveKbRules();
  if (!hasRuleMatch(rules, text)) return null;

  const body = matchRules(rules, text, 3).map(formatRuleForClient).join("\n\n");
  return locale === "ar"
    ? `هذا ما هو مسجّل بخصوص ذلك في قاعدة المعرفة الفعّالة:\n\n${body}\n\nملاحظة: القرار النهائي بشأن أي منتج محدد يصدر دائمًا عن مقيّمي أطلس.`
    : `Here's what's on file for that in the active knowledge base:\n\n${body}\n\nNote: the final determination for any specific product is always made by Atlas's evaluators.`;
}
