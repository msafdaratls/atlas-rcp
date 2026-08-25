/**
 * Shared, language-aware keyword matching for the two assistant chats'
 * stored-answer banks (canned-answers.ts and admin-canned-answers.ts).
 *
 * The original matcher was a raw `normalized.includes(keyword)` substring
 * test, which only fired when the user's phrasing happened to contain a
 * multi-word keyword verbatim: "how do I submit a request?" missed the
 * keyword "submit a request" purely because of the word "a". That was
 * tolerable while an AI call was the fallback for everything unmatched, but
 * with the AI path switched off (see ai-toggle.ts) the stored bank IS the
 * product, so matching has to survive ordinary rephrasing.
 *
 * What this does instead: normalize both sides, split into tokens, and treat
 * a keyword phrase as hit when *all* of its tokens appear anywhere in the
 * message, in any order. Score by token count so a longer, more specific
 * phrase outranks an incidental one-word overlap.
 */

const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Arabic and Latin inflect differently, so tokenMatches applies a different rule to each. */
function isArabic(token: string): boolean {
  return ARABIC_SCRIPT.test(token);
}

/** Tashkeel/harakat plus tatweel — decoration that varies by typist and must never affect a match. */
const ARABIC_DIACRITICS = /[ً-ْٰـ]/g;

/**
 * Folds the spelling variants that make Arabic substring matching miss:
 * hamza forms of alef, alef maqsura vs ya, ta marbuta vs ha. English is
 * only lowercased. Everything that isn't a letter or digit becomes a space,
 * so punctuation and emoji can't split or block a token.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Words that simply begin with alef-lam rather than carrying the definite
 * article. Length alone cannot separate these from real cases — "الطلب"
 * (the request) and "الغاء" (cancellation) are both five letters stripping
 * to three — so the ambiguous ones are listed. Written post-normalization,
 * which is the form stripArabicArticle actually sees.
 */
const NOT_ARTICLE_PREFIXED = new Set([
  "الغاء", "الغي", "الزام", "الزامي", "الزاميه", "التزام", "الحاق",
  "الكتروني", "الكترونيه", "الوان", "الهام", "الف", "الاف",
]);

/**
 * Strips the Arabic definite article so "الطلبات" and "طلب" reach the same
 * stem. Guarded on length so short words that merely start with alef-lam
 * (e.g. "ألم") aren't mutilated, and on the deny-list above for the longer
 * ones length cannot catch.
 */
function stripArabicArticle(token: string): string {
  if (token.length <= 4 || !token.startsWith("ال") || NOT_ARTICLE_PREFIXED.has(token)) return token;
  return token.slice(2);
}

/**
 * Grammatical glue, dropped from both sides. This matters asymmetrically:
 * a match requires every *keyword* token to be present in the message, so a
 * keyword phrase written as "submit a request" would otherwise fail on
 * "how do I submit requests?" purely because the user didn't type "a".
 * Only words that carry no topic signal are listed — question words like
 * "how" and "what" stay, since they cost nothing when both sides have them.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "i", "my", "me", "we", "our", "you", "your", "it", "its", "this", "that",
  "is", "are", "was", "were", "be", "am", "do", "does", "did", "to", "of", "for", "on", "in",
  "at", "by", "and", "or", "as", "can", "could", "would", "should", "will", "please",
  // Question and filler words. These have to go too: left in, a keyword like
  // "what do you do" collapses to the single token "what", which then scores
  // against every question a user asks and manufactures ties out of nothing.
  "how", "what", "which", "where", "when", "why", "who", "whom", "whose",
  "with", "from", "about", "there", "here", "into", "out", "up", "if", "not", "no",
  "but", "so", "then", "than", "also", "just", "only", "any", "some", "all", "more",
  "get", "got", "need", "want", "have", "has", "had", "make", "made", "show", "tell",
  "في", "على", "الى", "عن", "هل", "مع", "او", "ثم", "كيف", "ماذا", "اين", "متى", "لماذا",
  "انا", "لي", "هذا", "هذه", "التي", "الذي", "كل", "قد", "لا", "نعم",
// Normalized on the way in: tokenize() folds ى -> ي before consulting this
// set, so an entry written "على" would never be looked up and would survive
// as a scoring token, making every keyword phrase containing it harder to
// match rather than easier.
].map((word) => normalizeText(word)));

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .map(stripArabicArticle)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Deliberately loose: a keyword token matches a longer message token
 * (request -> requests, invoice -> invoices, طلب -> طلبي) and vice versa,
 * which covers plurals and Arabic affixes without a stemmer. The floor is 3
 * rather than 4 because Arabic roots are routinely three letters and a
 * higher floor missed the commonest inflections outright; 1-2 letter
 * fragments are already gone by tokenize().
 *
 * Both directions are prefix-anchored for Latin script: a message token may
 * be the stem of a longer keyword (invoice -> invoices) or vice versa, but
 * must not match from the middle or end, or "submit" would satisfy
 * "resubmit" and "word" would satisfy "password".
 */
function tokenMatches(needle: string, messageTokens: string[]): boolean {
  return messageTokens.some((t) => {
    if (t === needle) return true;

    // Arabic attaches affixes at BOTH ends (ال / و / ب prefixes, possessive
    // and plural suffixes), so neither direction can be anchored, and the
    // floor is 3 because Arabic roots are routinely three letters — طلب has
    // to be able to stem طلبي whichever side of the comparison it lands on.
    if (isArabic(needle) || isArabic(t)) {
      return (
        (needle.length >= 3 && t.includes(needle)) ||
        (t.length >= 3 && needle.includes(t))
      );
    }

    // Latin inflection is a suffix, so both directions anchor to the prefix.
    // An unanchored test here matched keyword fragments in the middle of
    // unrelated words — "word file" scored against "password"/"profile" and
    // answered a locked-out client with accepted upload formats.
    return (needle.length >= 3 && t.startsWith(needle)) || (t.length >= 4 && needle.startsWith(t));
  });
}

// Keyword lists are module constants re-scanned on every turn; tokenizing
// them is pure, so cache it rather than redoing the regex work per message.
const keywordTokenCache = new Map<string, string[]>();

function keywordTokens(keyword: string): string[] {
  let cached = keywordTokenCache.get(keyword);
  if (!cached) {
    cached = tokenize(keyword);
    keywordTokenCache.set(keyword, cached);
  }
  return cached;
}

export type KeywordEntry = { id: string; keywords: string[] };

/**
 * Full-phrase score: every token of a keyword must be present for it to
 * count, and it then contributes its own token count. "new request" beating
 * "request" is the point — it's the difference between the user naming a
 * topic and merely using a common word.
 */
export function scoreKeywords(keywords: string[], messageTokens: string[]): number {
  let score = 0;
  // Two phrasings of the same keyword routinely collapse to the same tokens
  // once stopwords are gone ("get my certificate" and "where is my
  // certificate" both become ["certificate"]). Counting each would score an
  // entry by how many ways its author happened to phrase one idea, which is
  // noise, and it manufactured ties against genuinely stronger matches.
  const counted = new Set<string>();
  for (const keyword of keywords) {
    const tokens = keywordTokens(keyword);
    if (tokens.length === 0) continue;
    const signature = tokens.join(" ");
    if (counted.has(signature)) continue;
    counted.add(signature);
    if (tokens.every((token) => tokenMatches(token, messageTokens))) {
      score += tokens.length;
    }
  }
  return score;
}

/**
 * Partial score used only to suggest near-miss topics in the fallback reply:
 * counts individual token hits without requiring the whole phrase, so
 * "coupon" still surfaces the discount topic even when nothing matched
 * confidently enough to answer outright.
 */
export function scorePartial(keywords: string[], messageTokens: string[]): number {
  const seen = new Set<string>();
  let score = 0;
  for (const keyword of keywords) {
    for (const token of keywordTokens(keyword)) {
      if (seen.has(token)) continue;
      seen.add(token);
      if (tokenMatches(token, messageTokens)) score += 1;
    }
  }
  return score;
}

/**
 * The single clear winner, or null. A tie means the message genuinely
 * pointed at two topics at once; answering with an arbitrary one of them
 * reads as the assistant misunderstanding, so the caller falls through to
 * the "here's what I can help with" fallback and lets the user pick.
 */
export function bestMatch<T extends KeywordEntry>(entries: T[], text: string): T | null {
  const messageTokens = tokenize(text);
  if (messageTokens.length === 0) return null;

  let best: { entry: T; score: number } | null = null;
  let tied = false;
  for (const entry of entries) {
    const score = scoreKeywords(entry.keywords, messageTokens);
    if (score === 0) continue;
    if (!best || score > best.score) {
      best = { entry, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  return !best || tied ? null : best.entry;
}

/** Ranks entries by partial overlap, best first — near-miss topics for the fallback reply. */
export function suggestEntries<T extends KeywordEntry>(entries: T[], text: string, limit: number): T[] {
  const messageTokens = tokenize(text);
  if (messageTokens.length === 0) return [];

  return entries
    .map((entry) => ({ entry, score: scorePartial(entry.keywords, messageTokens) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.entry);
}

/**
 * A human-readable topic name for the fallback list, taken from the entry's
 * own keywords in the caller's language — every entry already carries both
 * an English and an Arabic phrasing, so this stays correct without a second
 * bilingual field to keep in sync.
 */
export function topicLabel(entry: KeywordEntry, locale: string): string {
  const wantArabic = locale === "ar";
  const match = entry.keywords.find((k) => ARABIC_SCRIPT.test(k) === wantArabic);
  return match ?? entry.keywords[0] ?? entry.id;
}
