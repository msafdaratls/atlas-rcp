import { log } from "@/lib/logger";
import { redisConfigured, sendCommands } from "@/lib/redis/client";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitInput = {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
};

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterMs: number };

/**
 * Fixed-window rate limiter (in-process). Suitable for single-node / edge
 * soft protection; multi-instance deployments should replace with Redis.
 */
export function consumeRateLimit(input: RateLimitInput): RateLimitResult {
  const now = input.now ?? Date.now();
  const existing = buckets.get(input.key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(input.key, {
      count: 1,
      resetAt: now + input.windowMs,
    });
    return { ok: true, remaining: input.limit - 1 };
  }
  if (existing.count >= input.limit) {
    return { ok: false, retryAfterMs: existing.resetAt - now };
  }
  existing.count += 1;
  return { ok: true, remaining: input.limit - existing.count };
}

/** Test helper — clears all buckets. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

// Atomic fixed-window counter: INCR, set the TTL on first hit, return count+TTL.
const WINDOW_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

/**
 * Distributed rate limit, shared across instances when REDIS_URL is set
 * (RATE_LIMIT_DRIVER=redis). Falls back to the in-process limiter — and stays
 * fail-open on any Redis error — so a Redis outage never locks users out.
 */
export async function consumeRateLimitAsync(
  input: RateLimitInput,
): Promise<RateLimitResult> {
  const useRedis =
    (process.env.RATE_LIMIT_DRIVER ?? "memory").toLowerCase() === "redis" &&
    redisConfigured();

  if (!useRedis) return consumeRateLimit(input);

  try {
    const [reply] = await sendCommands([
      [
        "EVAL",
        WINDOW_SCRIPT,
        "1",
        `rl:${input.key}`,
        String(input.windowMs),
      ],
    ]);
    const [countRaw, ttlRaw] = Array.isArray(reply) ? reply : [reply, -1];
    const count = Number(countRaw);
    const ttl = Number(ttlRaw);
    if (count > input.limit) {
      return { ok: false, retryAfterMs: ttl > 0 ? ttl : input.windowMs };
    }
    return { ok: true, remaining: Math.max(0, input.limit - count) };
  } catch (error) {
    log.warn("rate-limit", "redis limiter failed; falling back to memory", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return consumeRateLimit(input);
  }
}
