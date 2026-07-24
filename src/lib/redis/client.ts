import { connect } from "node:net";

import { encodeCommand, parseReply, type RespValue } from "@/lib/redis/resp";

type RedisTarget = {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
};

export function parseRedisUrl(url: string): RedisTarget {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || "6379"),
    password: u.password || undefined,
    tls: u.protocol === "rediss:",
  };
}

let target: RedisTarget | null | undefined;
function getTarget(): RedisTarget | null {
  if (target === undefined) {
    target = process.env.REDIS_URL ? parseRedisUrl(process.env.REDIS_URL) : null;
  }
  return target;
}

export function redisConfigured(): boolean {
  return getTarget() !== null;
}

/**
 * Sends one or more commands on a single short-lived connection and returns
 * their replies in order. Small connection-per-call cost is acceptable for the
 * low-frequency auth rate-limit checks; swap for a pool if hot paths adopt it.
 * TLS (`rediss://`) is not implemented here — use a private-network Redis.
 */
export async function sendCommands(
  commands: string[][],
  timeoutMs = 2_000,
): Promise<RespValue[]> {
  const t = getTarget();
  if (!t) throw new Error("REDIS_NOT_CONFIGURED");
  if (t.tls) throw new Error("REDIS_TLS_UNSUPPORTED");

  const all: string[][] = t.password
    ? [["AUTH", t.password], ...commands]
    : commands;

  return new Promise<RespValue[]>((resolve, reject) => {
    const socket = connect({ host: t.host, port: t.port });
    let buffer = Buffer.alloc(0);
    const replies: RespValue[] = [];
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => done(() => reject(new Error("REDIS_TIMEOUT"))));
    socket.on("error", (err) => done(() => reject(err)));
    socket.on("connect", () => {
      for (const cmd of all) socket.write(encodeCommand(cmd));
    });
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      let offset = 0;
      while (replies.length < all.length) {
        const parsed = parseReply(buffer, offset);
        if (!parsed) break;
        replies.push(parsed.value);
        offset = parsed.offset;
      }
      if (replies.length >= all.length) {
        // Drop the AUTH reply so callers see only their command results.
        done(() => resolve(t.password ? replies.slice(1) : replies));
      }
    });
  });
}
