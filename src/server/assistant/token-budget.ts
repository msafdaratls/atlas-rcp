import { log } from "@/lib/logger";
import { redisConfigured, sendCommands } from "@/lib/redis/client";

/**
 * Platform-wide daily token budget for the assistant chats — a spend
 * guardrail on top of the per-user message-count rate limit in actions.ts
 * (that caps abuse from one account; this caps total spend across
 * everyone). Tune ASSISTANT_DAILY_TOKEN_BUDGET / ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET
 * to each surface's expected chat volume.
 *
 * `surface` keeps the client and admin/staff chats on independent counters —
 * without it, heavy admin usage could silently exhaust the client-facing
 * budget (or vice versa) with no visibility that the pool was shared.
 */
export type AssistantSurface = "client" | "admin";

const DEFAULT_DAILY_BUDGET = 1_000_000;

/** >1 day of margin; the counter key is itself date-scoped, so an imprecise expiry doesn't matter. */
const DAY_TTL_SECONDS = 26 * 60 * 60;

const BUDGET_ENV_VAR: Record<AssistantSurface, string> = {
  client: "ASSISTANT_DAILY_TOKEN_BUDGET",
  admin: "ADMIN_ASSISTANT_DAILY_TOKEN_BUDGET",
};

function budgetLimit(surface: AssistantSurface): number {
  const parsed = Number(process.env[BUDGET_ENV_VAR[surface]]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_BUDGET;
}

function todayKey(surface: AssistantSurface): string {
  return `assistant-tokens:${surface}:${new Date().toISOString().slice(0, 10)}`;
}

// In-process fallback when Redis isn't configured, or on a Redis error — same
// fail-open convention as consumeRateLimitAsync: a tracking outage must never
// lock out every client at once, so an unreadable/unwritable budget is
// treated as "not exceeded" rather than blocking the assistant.
const memoryTotals = new Map<string, number>();

async function readTotal(key: string): Promise<number> {
  if (redisConfigured()) {
    try {
      const [reply] = await sendCommands([["GET", key]]);
      return reply == null ? 0 : Number(reply);
    } catch (error) {
      log.warn("assistant.chat", "token budget read failed; failing open", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return 0;
    }
  }
  return memoryTotals.get(key) ?? 0;
}

/** Peek only — call before spending tokens on a turn. */
export async function isTokenBudgetExceeded(surface: AssistantSurface): Promise<boolean> {
  return (await readTotal(todayKey(surface))) >= budgetLimit(surface);
}

/** Call once a Claude call completes, with its actual input+output token count. */
export async function recordTokenUsage(tokens: number, surface: AssistantSurface): Promise<void> {
  const key = todayKey(surface);
  if (redisConfigured()) {
    try {
      await sendCommands([
        ["SET", key, "0", "EX", String(DAY_TTL_SECONDS), "NX"],
        ["INCRBY", key, String(tokens)],
      ]);
      return;
    } catch (error) {
      log.warn("assistant.chat", "token budget write failed; recording in-process only", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  memoryTotals.set(key, (memoryTotals.get(key) ?? 0) + tokens);
}

export const BUDGET_EXCEEDED_REPLY = {
  en: "The assistant has reached its usage limit for today — please try again tomorrow, or reach out through the Support page in the meantime.",
  ar: "بلغ المساعد الحد الأقصى لاستخدامه اليوم — يرجى المحاولة مرة أخرى غدًا، أو التواصل عبر صفحة الدعم في هذه الأثناء.",
};

export const ADMIN_BUDGET_EXCEEDED_REPLY = {
  en: "The assistant has reached its usage limit for today — please try again tomorrow, or check with a colleague or System Admin in the meantime.",
  ar: "بلغ المساعد الحد الأقصى لاستخدامه اليوم — يرجى المحاولة مرة أخرى غدًا، أو الاستفسار من أحد الزملاء أو مدير النظام في هذه الأثناء.",
};
