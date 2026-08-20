import type Anthropic from "@anthropic-ai/sdk";
import type { LabelEvalDomain } from "@prisma/client";
import { getAnthropicClient } from "@/lib/anthropic-client";
import { log } from "@/lib/logger";
import { searchKbRules } from "@/server/assistant/kb-search";

const MODEL = process.env.ASSISTANT_CLAUDE_MODEL || "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 3;
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
 */
export async function runAssistantTurn(input: {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
}): Promise<{ text: string; model: string }> {
  const client = getAnthropicClient();
  const working: Anthropic.MessageParam[] = [...input.messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: input.systemPrompt,
      tools: TOOLS,
      messages: working,
    });

    log.info("assistant.chat", "claude turn completed", {
      model: MODEL,
      round,
      stopReason: response.stop_reason,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { text: text || FALLBACK_TEXT, model: MODEL };
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
  return { text: FALLBACK_TEXT, model: MODEL };
}
