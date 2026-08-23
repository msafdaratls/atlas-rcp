import type { AssistantMessageDto } from "@/server/assistant/queries";

/**
 * How many of the most recent messages get sent to Claude as conversation
 * context. Deliberately smaller than HISTORY_LIMIT (queries.ts, which governs
 * what the UI displays) — only the last few turns go into the prompt, to
 * bound input-token cost on long-running threads. Must stay even: messages
 * strictly alternate USER/ASSISTANT, and the Messages API rejects a list
 * that doesn't start on "user".
 */
export const MODEL_CONTEXT_LIMIT = 10;

/**
 * Slices the most recent `limit` messages, dropping a leading ASSISTANT
 * message (if the cut lands mid-pair) so the result always starts on USER.
 */
export function trimForModel(history: AssistantMessageDto[], limit: number): AssistantMessageDto[] {
  const recent = history.slice(-limit);
  return recent[0]?.role === "ASSISTANT" ? recent.slice(1) : recent;
}
