import Anthropic from "@anthropic-ai/sdk";

let cachedClient: Anthropic | null = null;

/**
 * Process-wide cached Anthropic client, shared by every AI-assisted feature
 * (label-eval, the client assistant chat, ...) so there's exactly one
 * instance per process. `new Anthropic()` resolves ANTHROPIC_API_KEY from
 * the environment; callers are expected to check
 * `process.env.ANTHROPIC_API_KEY` before calling in and fail closed if unset
 * — this module doesn't decide that for any given feature.
 */
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    // Explicit timeout: the chat path calls this synchronously inside a
    // server action, so an SDK-default (much longer) hang would tie up that
    // request. Background call sites (extraction/judgment workers) are
    // already covered by their own outbox retry/backoff.
    cachedClient = new Anthropic({ timeout: 45_000 });
  }
  return cachedClient;
}
