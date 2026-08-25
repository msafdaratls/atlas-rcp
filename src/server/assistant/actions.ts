"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { consumeRateLimitAsync } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { isAssistantAiEnabled } from "@/server/assistant/ai-toggle";
import { buildFallbackReply, matchCannedAnswer } from "@/server/assistant/canned-answers";
import { buildCatalogueContext } from "@/server/assistant/catalogue-context";
import { MAX_MESSAGE_LENGTH } from "@/server/assistant/constants";
import { MODEL_CONTEXT_LIMIT, trimForModel } from "@/server/assistant/history-window";
import { isLikelyOffTopic, OFF_TOPIC_REPLY } from "@/server/assistant/off-topic-guard";
import { getOrCreateConversation, listRecentMessages, type AssistantMessageDto } from "@/server/assistant/queries";
import { findRegulatoryAnswer } from "@/server/assistant/regulatory-lookup";
import { runAssistantTurn } from "@/server/assistant/run-turn";
import { findServiceAnswer } from "@/server/assistant/service-lookup";
import { buildSystemPrompt } from "@/server/assistant/system-prompt";
import { BUDGET_EXCEEDED_REPLY, isTokenBudgetExceeded } from "@/server/assistant/token-budget";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const sendSchema = z.object({
  text: z.string().trim().min(1, "EMPTY").max(MAX_MESSAGE_LENGTH, "TOO_LONG"),
});

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
 * One chat turn. Before ever calling Claude, tries — in order — a
 * regulatory-clause lookup (live KB rules), a specific-service lookup (live
 * catalogue row), a canned answer (generic platform/process question), and a
 * static decline for an obviously off-topic message. All four are answered
 * straight from stored data: no AI call, no tokens spent, and (unlike a
 * canned string) the first two are always current since they're read from
 * the database on every turn. Only a message none of them can confidently
 * resolve reaches Claude — grounded in the live catalogue +
 * search_regulatory_rules tool — gated last by the daily token-budget guard.
 * Persists whichever reply it lands on and returns the refreshed transcript.
 *
 * The AI step is off by default (ai-toggle.ts). While it's off, a message
 * none of the stored paths resolved gets buildFallbackReply's "here's what
 * I can answer" reply — near-miss topics drawn from the same bank — rather
 * than a dead end, and no token is ever spent.
 */
export async function sendAssistantMessage(input: { text: string }): Promise<ActionResult<AssistantMessageDto[]>> {
  try {
    const session = await requireSession();
    requirePermission(session, "assistant:use");
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message === "TOO_LONG" ? "TOO_LONG" : "EMPTY" };
    }

    // While the AI is on, any turn can end up a paid model call, so the cap
    // is tight and applies uniformly (even to stored replies) — probing for
    // the free paths must not itself be a way around the cost limit. With
    // the AI off there is no bill to run up and the assistant is purely a
    // help manual, so a client working through a list of questions must not
    // be cut off after twenty; the looser cap is then only abuse protection
    // for the per-turn database writes.
    const aiEnabled = isAssistantAiEnabled();
    const limited = await consumeRateLimitAsync({
      key: `assistant-chat:${session.id}`,
      limit: aiEnabled ? 20 : 120,
      windowMs: 60 * 60 * 1000,
    });
    if (!limited.ok) {
      return { ok: false, error: "RATE_LIMITED" };
    }

    const conversation = await getOrCreateConversation(session);
    await prisma.assistantMessage.create({
      data: { conversationId: conversation.id, role: "USER", content: parsed.data.text },
    });

    const reply = async (content: string, model: string) => {
      await prisma.assistantMessage.create({
        data: { conversationId: conversation.id, role: "ASSISTANT", content, model },
      });
      return { ok: true as const, data: await listRecentMessages(conversation.id) };
    };

    const regulatory = await findRegulatoryAnswer(parsed.data.text, session.locale);
    if (regulatory) {
      return reply(regulatory, "kb-lookup");
    }

    const serviceAnswer = await findServiceAnswer(parsed.data.text, session.locale);
    if (serviceAnswer) {
      return reply(serviceAnswer, "service-lookup");
    }

    // With the AI off there's nothing better for a service-specific message
    // to fall through to, so the generic process answer beats no answer;
    // with it on, that message is worth the model's full catalogue grounding.
    const canned = matchCannedAnswer(parsed.data.text, { deferSpecificServiceToAi: aiEnabled });
    if (canned) {
      return reply(session.locale === "ar" ? canned.ar : canned.en, "canned");
    }

    if (isLikelyOffTopic(parsed.data.text)) {
      return reply(session.locale === "ar" ? OFF_TOPIC_REPLY.ar : OFF_TOPIC_REPLY.en, "off-topic-guard");
    }

    if (!aiEnabled) {
      return reply(buildFallbackReply(parsed.data.text, session.locale), "stored-fallback");
    }

    if (await isTokenBudgetExceeded("client")) {
      return reply(session.locale === "ar" ? BUDGET_EXCEEDED_REPLY.ar : BUDGET_EXCEEDED_REPLY.en, "budget-exceeded");
    }

    const history = await listRecentMessages(conversation.id);
    const catalogueContext = await buildCatalogueContext();
    const systemPrompt = buildSystemPrompt({ locale: session.locale, catalogueContext });
    const claudeMessages: Anthropic.MessageParam[] = trimForModel(history, MODEL_CONTEXT_LIMIT).map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    // runAssistantTurn records token spend itself, per round, as it happens —
    // see its doc comment for why that can't be batched here after the call.
    const { text, model } = await runAssistantTurn({ systemPrompt, messages: claudeMessages, surface: "client" });

    return reply(text, model);
  } catch (err) {
    return toActionError(err);
  }
}
