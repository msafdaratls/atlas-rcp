import { connect } from "node:net";

/**
 * Minimal clamd client (dependency-free) using the INSTREAM command. Streams a
 * buffer to a running clamd and returns its verdict. Protocol framing and reply
 * parsing are pure functions so they can be unit-tested without a live daemon.
 *
 * INSTREAM: send `zINSTREAM\0`, then repeated `<uint32 BE length><chunk>`, then
 * a zero-length chunk to terminate. clamd replies `stream: OK` or
 * `stream: <signature> FOUND`.
 */

export type AvVerdict = "CLEAN" | "INFECTED";

const MAX_CHUNK = 64 * 1024;

/** Builds the INSTREAM body frames (excluding the command) for a payload. */
export function buildInstreamFrames(
  body: Buffer,
  maxChunk = MAX_CHUNK,
): Buffer {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < body.length; offset += maxChunk) {
    const chunk = body.subarray(offset, offset + maxChunk);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(chunk.length, 0);
    parts.push(size, chunk);
  }
  const terminator = Buffer.alloc(4);
  terminator.writeUInt32BE(0, 0);
  parts.push(terminator);
  return Buffer.concat(parts);
}

/** Parses a clamd reply string into a verdict; throws on protocol errors. */
export function parseClamReply(reply: string): AvVerdict {
  const text = reply.replace(/\0/g, "").trim();
  if (/\bFOUND\b/.test(text)) return "INFECTED";
  if (/\bOK\b/.test(text)) return "CLEAN";
  throw new Error(`CLAMD_UNEXPECTED_REPLY: ${text || "(empty)"}`);
}

export type ClamAvOptions = {
  host: string;
  port: number;
  timeoutMs?: number;
};

export async function scanWithClamd(
  body: Buffer,
  options: ClamAvOptions,
): Promise<AvVerdict> {
  const timeoutMs = options.timeoutMs ?? 15_000;

  return new Promise<AvVerdict>((resolve, reject) => {
    const socket = connect({ host: options.host, port: options.port });
    const chunks: Buffer[] = [];
    let settled = false;

    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => done(() => reject(new Error("CLAMD_TIMEOUT"))));
    socket.on("error", (err) => done(() => reject(err)));
    socket.on("data", (d: Buffer) => chunks.push(d));
    socket.on("end", () => {
      try {
        const verdict = parseClamReply(Buffer.concat(chunks).toString("utf8"));
        done(() => resolve(verdict));
      } catch (err) {
        done(() => reject(err));
      }
    });

    socket.on("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0", "ascii"));
      socket.write(buildInstreamFrames(body));
    });
  });
}
