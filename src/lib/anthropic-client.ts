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
  if (!cachedClient) cachedClient = new Anthropic();
  return cachedClient;
}
