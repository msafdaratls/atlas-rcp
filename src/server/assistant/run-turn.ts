import type Anthropic from "@anthropic-ai/sdk";
import type { LabelEvalDomain } from "@prisma/client";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { log } from "@/lib/logger";
import { searchKbRules } from "@/server/assistant/kb-search";
import { recordTokenUsage, type AssistantSurface } from "@/server/assistant/token-budget";

const MODEL = process.env.ASSISTANT_CLAUDE_MODEL || "claude-sonnet-5";
// Two rounds is one tool call plus the answer that uses it, which is the only
// shape search_regulatory_rules actually needs. A third round only ever
// bought a second search, and every extra round re-sends the whole prompt.
const MAX_TOOL_ROUNDS = 2;
// The system prompt asks for a short answer and output is billed on what is
// actually produced, so this is a runaway guard rather than a budget: set it
// low enough to bound the worst case, high enough that a normal answer is
// never cut off mid-sentence (a truncated reply just gets asked again, which
// costs more than it saves).
const MAX_OUTPUT_TOKENS = 800;
const FALLBACK_TEXT =
  "I wasn't able to put together a clear answer to that — please reach out through the Support page and the team will help directly.";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_regulatory_rules",
    description:
      "Search Atlas's active knowledge base of regulatory clauses/checklist items (SFDA supplement labeling standards, GSO 1943 cosmetics labeling, etc.) for ones matching a topic or keyword. Use this whenever the client asks about a specific clause, standard, or 'why would this fail' question. Only state what this tool returns — never invent a clause it doesn't return.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Topic or keyword to search for, e.g. 'net weight declaration' or 'nickel restriction'." },
        domain: {
          type: "string",
          enum: ["SFDA_SUPPLEMENTS", "COSMETICS"],
          description: "Restrict the search to one domain if the client's question makes it clear which; omit to search both.",
        },
      },
      required: ["query"],
    },
  },
];

async function runTool(name: string, input: unknown): Promise<string> {
  if (name !== "search_regulatory_rules") return `Unknown tool: ${name}`;
  const args = input as { query?: unknown; domain?: unknown };
  const query = typeof args.query === "string" ? args.query : "";
  const domain =
    args.domain === "SFDA_SUPPLEMENTS" || args.domain === "COSMETICS"
      ? (args.domain as LabelEvalDomain)
      : undefined;
  return searchKbRules(query, domain);
}

/**
 * Runs one assistant turn against the Messages API, executing
 * search_regulatory_rules tool calls in a bounded loop (cost guard — mirrors
 * label-eval/llm/client.ts's per-call logging, but this feature is
 * conversational so it doesn't use the structured-output helper there).
 *
 * Records each round's token usage against the daily budget immediately,
 * not batched at the end: if a later round throws (e.g. a transient API
 * error), tokens already spent in an earlier round of this same turn must
 * still count — otherwise the budget guard silently undercounts real spend.
 */
export async function runAssistantTurn(input: {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  surface: AssistantSurface;
}): Promise<{ text: string; model: string; totalTokens: number }> {
  const client = getAnthropicClient();
  const working: Anthropic.MessageParam[] = [...input.messages];
  let totalTokens = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Cached, because this is where nearly all the input cost lives: the
      // system prompt carries the whole service catalogue (client) or role
      // manual (admin) and is byte-identical on every turn of every
      // conversation, so re-sending it at full price each time was paying
      // over and over for text that never changes. Caching is a prefix match
      // over tools -> system -> messages, and TOOLS is a module constant, so
      // one breakpoint here covers both. Reads bill at ~10% of the input
      // rate; the trade is that the first turn of a cold conversation writes
      // the cache at ~125%, which pays for itself from the second turn on.
      system: [{ type: "text", text: input.systemPrompt, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages: working,
    });

    // Caching moves the bulk of the prompt OUT of `input_tokens` and into the
    // two cache counters, so summing input+output alone would silently stop
    // counting ~85% of every turn and quietly loosen the daily budget by
    // roughly an order of magnitude. Count every token the request actually
    // processed, cached or not, so the guard keeps meaning what its name says.
    const cacheWrite = response.usage.cache_creation_input_tokens ?? 0;
    const cacheRead = response.usage.cache_read_input_tokens ?? 0;
    const roundTokens =
      response.usage.input_tokens + cacheWrite + cacheRead + response.usage.output_tokens;
    totalTokens += roundTokens;
    await recordTokenUsage(roundTokens, input.surface);

    log.info("assistant.chat", "claude turn completed", {
      model: MODEL,
      round,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // A cacheRead of 0 on a follow-up turn means the prefix stopped
      // matching — the prompt picked up something volatile and the saving is
      // gone. Logged so that shows up rather than just costing more.
      cacheWrite,
      cacheRead,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { text: text || FALLBACK_TEXT, model: MODEL, totalTokens };
    }

    working.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => ({
        type: "tool_result" as const,
        tool_use_id: block.id,
        content: await runTool(block.name, block.input),
      })),
    );
    working.push({ role: "user", content: toolResults });
  }

  log.warn("assistant.chat", "tool loop exceeded max rounds without a final answer", { model: MODEL });
  return { text: FALLBACK_TEXT, model: MODEL, totalTokens };
}
