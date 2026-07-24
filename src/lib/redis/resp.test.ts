import assert from "node:assert/strict";
import { test } from "node:test";

import { encodeCommand, parseReply } from "./resp";

test("encodeCommand builds a RESP array of bulk strings", () => {
  assert.equal(
    encodeCommand(["INCR", "login:1.2.3.4"]).toString(),
    "*2\r\n$4\r\nINCR\r\n$13\r\nlogin:1.2.3.4\r\n",
  );
});

test("parseReply handles integers, simple strings, and errors", () => {
  assert.deepEqual(parseReply(Buffer.from(":7\r\n")), { value: 7, offset: 4 });
  assert.deepEqual(parseReply(Buffer.from("+OK\r\n")), {
    value: "OK",
    offset: 5,
  });
  assert.deepEqual(parseReply(Buffer.from("-ERR nope\r\n")), {
    value: "ERR nope",
    offset: 11,
  });
});

test("parseReply handles bulk strings and null", () => {
  assert.deepEqual(parseReply(Buffer.from("$3\r\nfoo\r\n")), {
    value: "foo",
    offset: 9,
  });
  assert.deepEqual(parseReply(Buffer.from("$-1\r\n")), {
    value: null,
    offset: 5,
  });
});

test("parseReply handles nested arrays", () => {
  const parsed = parseReply(Buffer.from("*2\r\n:1\r\n$3\r\nbar\r\n"));
  assert.deepEqual(parsed?.value, [1, "bar"]);
});

test("parseReply returns null on an incomplete buffer (partial TCP read)", () => {
  assert.equal(parseReply(Buffer.from("$3\r\nfo")), null);
  assert.equal(parseReply(Buffer.from(":7\r")), null);
});
