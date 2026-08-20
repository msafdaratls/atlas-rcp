"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { requirePermission } from "@/lib/rbac";
import { buildCatalogueContext } from "@/server/assistant/catalogue-context";
import { MAX_MESSAGE_LENGTH } from "@/server/assistant/constants";
import { getOrCreateConversation, listRecentMessages, type AssistantMessageDto } from "@/server/assistant/queries";
import { runAssistantTurn } from "@/server/assistant/run-turn";
import { buildSystemPrompt } from "@/server/assistant/system-prompt";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const sendSchema = z.object({
  text: z.string().trim().min(1, "EMPTY").max(MAX_MESSAGE_LENGTH, "TOO_LONG"),
});

const UNAVAILABLE_TEXT =
  "The assistant is temporarily unavailable — please reach out through the Support page and the team will help directly.";

function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN")) {
    return { ok: false, error: err.message };
  }
  log.error("assistant.chat", "action failed", { error: String(err) });
  return { ok: false, error: "FAILED" };
}

export async function getAssistantHistory(): Promise<ActionResult<AssistantMessageDto[]>> {
  try {
    const session = await requireSession();
    requirePermission(session, "assistant:use");
    const conversation = await getOrCreateConversation(session);
    return { ok: true, data: await listRecentMessages(conversation.id) };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * One chat turn: persists the client's message, gets (or fails closed to a
 * fixed unavailable notice for) Claude's reply grounded in the live
 * catalogue + the search_regulatory_rules tool, persists that too, and
 * returns the refreshed transcript. Never calls out when ANTHROPIC_API_KEY
 * is unset — same fail-closed convention as label-eval's AI call sites.
 */
export async function sendAssistantMessage(input: { text: string }): Promise<ActionResult<AssistantMessageDto[]>> {
  try {
    const session = await requireSession();
    requirePermission(session, "assistant:use");
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message === "TOO_LONG" ? "TOO_LONG" : "EMPTY" };
    }

    const conversation = await getOrCreateConversation(session);
    await prisma.assistantMessage.create({
      data: { conversationId: conversation.id, role: "USER", content: parsed.data.text },
    });

    if (!process.env.ANTHROPIC_API_KEY) {
      await prisma.assistantMessage.create({
        data: { conversationId: conversation.id, role: "ASSISTANT", content: UNAVAILABLE_TEXT },
      });
      return { ok: true, data: await listRecentMessages(conversation.id) };
    }

    const history = await listRecentMessages(conversation.id);
    const catalogueContext = await buildCatalogueContext();
    const systemPrompt = buildSystemPrompt({ locale: session.locale, catalogueContext });
    const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    const { text, model } = await runAssistantTurn({ systemPrompt, messages: claudeMessages });

    await prisma.assistantMessage.create({
      data: { conversationId: conversation.id, role: "ASSISTANT", content: text, model },
    });

    return { ok: true, data: await listRecentMessages(conversation.id) };
  } catch (err) {
    return toActionError(err);
  }
}
