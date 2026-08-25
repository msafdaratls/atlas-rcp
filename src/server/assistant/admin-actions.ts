"use server";

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { consumeRateLimitAsync } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/rbac";
import { isAssistantAiEnabled } from "@/server/assistant/ai-toggle";
import { buildAdminFallbackReply, matchCannedAnswer } from "@/server/assistant/admin-canned-answers";
import { buildAdminManualContext } from "@/server/assistant/admin-manual-context";
import { buildAdminSystemPrompt } from "@/server/assistant/admin-system-prompt";
import { MAX_MESSAGE_LENGTH } from "@/server/assistant/constants";
import { MODEL_CONTEXT_LIMIT, trimForModel } from "@/server/assistant/history-window";
import { isLikelyOffTopic } from "@/server/assistant/off-topic-guard";
import { getOrCreateConversation, listRecentMessages, type AssistantMessageDto } from "@/server/assistant/queries";
import { findRegulatoryAnswer } from "@/server/assistant/regulatory-lookup";
import { runAssistantTurn } from "@/server/assistant/run-turn";
import { findServiceAnswer } from "@/server/assistant/service-lookup";
import { ADMIN_BUDGET_EXCEEDED_REPLY, isTokenBudgetExceeded } from "@/server/assistant/token-budget";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const sendSchema = z.object({
  text: z.string().trim().min(1, "EMPTY").max(MAX_MESSAGE_LENGTH, "TOO_LONG"),
});

const ADMIN_OFF_TOPIC_REPLY = {
  en: "I'm the Atlas Staff Guide — I can only help with using the admin console and the request workflow. For anything else, please reach out to a colleague or System Admin.",
  ar: "أنا دليل موظفي أطلس — يمكنني المساعدة فقط في استخدام لوحة الإدارة وسير عمل الطلبات. لأي أمر آخر، يرجى التواصل مع أحد الزملاء أو مدير النظام.",
};

function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof Error && (err.message === "UNAUTHORIZED" || err.message === "FORBIDDEN")) {
    return { ok: false, error: err.message };
  }
  log.error("admin-assistant.chat", "action failed", { error: String(err) });
  return { ok: false, error: "FAILED" };
}

export async function getAdminAssistantHistory(): Promise<ActionResult<AssistantMessageDto[]>> {
  try {
    const session = await requireSession();
    requirePermission(session, "assistant:staff-use");
    const conversation = await getOrCreateConversation(session);
    return { ok: true, data: await listRecentMessages(conversation.id) };
  } catch (err) {
    return toActionError(err);
  }
}

/**
 * One chat turn for Atlas staff — same shape as the client assistant's
 * sendAssistantMessage (see its doc comment), but grounded in the written
 * admin manual instead of the live catalogue, and role-filtered throughout:
 * a canned answer or the AI's manual context only ever include sections the
 * caller's own role(s) can see. Tracks its own daily token budget and rate
 * limit, independent of the client assistant's (token-budget.ts's
 * `surface` param) so heavy use on one side can never lock out the other.
 */
export async function sendAdminAssistantMessage(input: { text: string }): Promise<ActionResult<AssistantMessageDto[]>> {
  try {
    const session = await requireSession();
    requirePermission(session, "assistant:staff-use");
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message === "TOO_LONG" ? "TOO_LONG" : "EMPTY" };
    }

    // Tight while the AI can bill, loose once it can't — see the client
    // assistant's sendAssistantMessage for the reasoning.
    const aiEnabled = isAssistantAiEnabled();
    const limited = await consumeRateLimitAsync({
      key: `admin-assistant-chat:${session.id}`,
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

    const canned = matchCannedAnswer(parsed.data.text, session.roles);
    if (canned) {
      return reply(session.locale === "ar" ? canned.ar : canned.en, "canned");
    }

    if (isLikelyOffTopic(parsed.data.text)) {
      return reply(session.locale === "ar" ? ADMIN_OFF_TOPIC_REPLY.ar : ADMIN_OFF_TOPIC_REPLY.en, "off-topic-guard");
    }

    // Off by default (ai-toggle.ts) — the role-filtered stored bank answers
    // instead, and says what it can cover rather than dead-ending.
    if (!aiEnabled) {
      return reply(buildAdminFallbackReply(parsed.data.text, session.roles, session.locale), "stored-fallback");
    }

    if (await isTokenBudgetExceeded("admin")) {
      return reply(
        session.locale === "ar" ? ADMIN_BUDGET_EXCEEDED_REPLY.ar : ADMIN_BUDGET_EXCEEDED_REPLY.en,
        "budget-exceeded",
      );
    }

    const history = await listRecentMessages(conversation.id);
    const manualContext = buildAdminManualContext(session.roles);
    const systemPrompt = buildAdminSystemPrompt({ locale: session.locale, roles: session.roles, manualContext });
    const claudeMessages: Anthropic.MessageParam[] = trimForModel(history, MODEL_CONTEXT_LIMIT).map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    const { text, model } = await runAssistantTurn({ systemPrompt, messages: claudeMessages, surface: "admin" });

    return reply(text, model);
  } catch (err) {
    return toActionError(err);
  }
}
