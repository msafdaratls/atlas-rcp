import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { log } from "@/lib/logger";

/**
 * Structured-output helper for the three AI-assisted steps in this feature
 * (extraction, judgment-proposal, cosmetics classification — see the
 * label-evaluator design doc §10 "cost guards"). Server-side only — never
 * imported by client code. Callers are expected to check
 * `process.env.ANTHROPIC_API_KEY` before calling in (each call site fails
 * closed to its existing manual/deterministic behavior when unset, per
 * extraction/provider.ts's existing pattern — this module does not itself
 * decide what "unset" means for any given feature).
 */

export type StructuredCallInput<T> = {
  /** Logger scope + usage-log tag, e.g. "label-eval.extraction". */
  scope: string;
  model: string;
  system?: string;
  content: Anthropic.Messages.ContentBlockParam[];
  schema: z.ZodType<T>;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
};

/**
 * One structured Messages API call: sends `content`, constrains the response
 * to `schema` via native structured outputs, and returns the parsed result.
 * Logs token usage (design doc §10's cost guard) on every call, success or
 * failure. Throws on a network/API error or an unparseable response — callers
 * decide how to fail closed (per-item fallback, not a crash), matching the
 * pattern already used by the extraction job's own retry/backoff.
 */
export async function callStructured<T>(input: StructuredCallInput<T>): Promise<T> {
  const message = await getAnthropicClient().messages.parse({
    model: input.model,
    max_tokens: input.maxTokens ?? 8000,
    ...(input.system ? { system: input.system } : {}),
    output_config: {
      format: zodOutputFormat(input.schema),
      ...(input.effort ? { effort: input.effort } : {}),
    },
    messages: [{ role: "user", content: input.content }],
  });

  log.info(input.scope, "claude structured call completed", {
    model: input.model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  });

  if (message.parsed_output === null || message.parsed_output === undefined) {
    throw new Error(`CLAUDE_PARSE_FAILED:${input.scope}`);
  }
  return message.parsed_output;
}
