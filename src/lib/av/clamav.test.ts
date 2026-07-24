import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInstreamFrames, parseClamReply } from "./clamav";

test("buildInstreamFrames prefixes each chunk with a big-endian length + zero terminator", () => {
  const body = Buffer.from("hello world");
  const frames = buildInstreamFrames(body, 4);

  // "hell" (4) | "o wo" (4) | "rld" (3) | terminator (0)
  assert.equal(frames.readUInt32BE(0), 4);
  assert.equal(frames.subarray(4, 8).toString(), "hell");
  assert.equal(frames.readUInt32BE(8), 4);
  assert.equal(frames.subarray(12, 16).toString(), "o wo");
  assert.equal(frames.readUInt32BE(16), 3);
  assert.equal(frames.subarray(20, 23).toString(), "rld");
  // final 4 bytes are the zero-length terminator
  assert.equal(frames.readUInt32BE(frames.length - 4), 0);
});

test("empty payload still emits a terminator", () => {
  const frames = buildInstreamFrames(Buffer.alloc(0));
  assert.equal(frames.length, 4);
  assert.equal(frames.readUInt32BE(0), 0);
});

test("parseClamReply maps clamd verdicts", () => {
  assert.equal(parseClamReply("stream: OK\0"), "CLEAN");
  assert.equal(
    parseClamReply("stream: Eicar-Test-Signature FOUND\0"),
    "INFECTED",
  );
});

test("parseClamReply throws on an unexpected reply", () => {
  assert.throws(() => parseClamReply("INSTREAM size limit exceeded"), /CLAMD_UNEXPECTED_REPLY/);
});
