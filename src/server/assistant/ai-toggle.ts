/**
 * Master switch for whether either assistant chat is allowed to spend
 * Claude tokens.
 *
 * Deliberately a separate variable from ANTHROPIC_API_KEY rather than
 * "unset the key to turn it off": the key is shared with the label-evaluator
 * AI paths (extraction, judgment proposals, cosmetics classification), so
 * removing it to silence the chat would also switch those off. This gates
 * the two chat surfaces and nothing else.
 *
 * Default is OFF. The chats run entirely from the stored answer bank —
 * live catalogue lookups, live KB-rule lookups, and the canned Q&A in
 * canned-answers.ts / admin-canned-answers.ts — and cost nothing.
 *
 * To turn the AI fallback back on later, set both:
 *   ASSISTANT_AI_ENABLED="true"
 *   ANTHROPIC_API_KEY="sk-ant-..."
 * Nothing else changes: the stored answers keep answering first and the AI
 * only ever sees what they couldn't resolve, so enabling it is additive.
 */
export function isAssistantAiEnabled(): boolean {
  return process.env.ASSISTANT_AI_ENABLED === "true" && Boolean(process.env.ANTHROPIC_API_KEY);
}
