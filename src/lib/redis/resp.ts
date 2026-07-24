/**
 * Minimal RESP2 (Redis serialization protocol) encoder/decoder — dependency-
 * free, pure functions so they can be unit-tested without a live Redis. Only
 * what the rate limiter needs: encode a command as an array of bulk strings,
 * and parse simple strings, errors, integers, bulk strings, and arrays.
 */

export type RespValue = string | number | null | RespValue[];

const CRLF = "\r\n";

/** Encodes a command (e.g. ["INCR", "key"]) as a RESP array of bulk strings. */
export function encodeCommand(args: string[]): Buffer {
  let out = `*${args.length}${CRLF}`;
  for (const arg of args) {
    const buf = Buffer.from(arg, "utf8");
    out += `$${buf.length}${CRLF}${arg}${CRLF}`;
  }
  return Buffer.from(out, "utf8");
}

/**
 * Parses a single RESP reply from `buf` starting at `offset`.
 * Returns the value and the new offset, or null if `buf` is incomplete.
 */
export function parseReply(
  buf: Buffer,
  offset = 0,
): { value: RespValue; offset: number } | null {
  const lineEnd = buf.indexOf("\r\n", offset);
  if (lineEnd === -1) return null;

  const type = buf[offset];
  const header = buf.toString("utf8", offset + 1, lineEnd);
  const next = lineEnd + 2;

  switch (type) {
    case 0x2b: // '+' simple string
      return { value: header, offset: next };
    case 0x2d: // '-' error
      return { value: header, offset: next };
    case 0x3a: // ':' integer
      return { value: Number(header), offset: next };
    case 0x24: {
      // '$' bulk string
      const len = Number(header);
      if (len === -1) return { value: null, offset: next };
      const end = next + len;
      if (buf.length < end + 2) return null;
      return { value: buf.toString("utf8", next, end), offset: end + 2 };
    }
    case 0x2a: {
      // '*' array
      const count = Number(header);
      if (count === -1) return { value: null, offset: next };
      const items: RespValue[] = [];
      let cursor = next;
      for (let i = 0; i < count; i += 1) {
        const parsed = parseReply(buf, cursor);
        if (!parsed) return null;
        items.push(parsed.value);
        cursor = parsed.offset;
      }
      return { value: items, offset: cursor };
    }
    default:
      throw new Error(`RESP_UNKNOWN_TYPE_${String.fromCharCode(type ?? 0)}`);
  }
}

/** True when the reply is a RESP error (leading '-'). */
export function isRespError(buf: Buffer, offset = 0): boolean {
  return buf[offset] === 0x2d;
}
