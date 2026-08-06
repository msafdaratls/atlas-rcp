import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./vault";

before(() => {
  process.env.CREDENTIALS_MASTER_KEY = randomBytes(32).toString("base64");
});

function flipFirstByte(base64: string): string {
  const buf = Buffer.from(base64, "base64");
  buf[0] = buf[0]! ^ 0xff;
  return buf.toString("base64");
}

describe("encryptSecret / decryptSecret", () => {
  it("round-trips plaintext", () => {
    const plaintext = "correct-horse-battery-staple";
    const encrypted = encryptSecret(plaintext);
    assert.equal(decryptSecret(encrypted), plaintext);
  });

  it("produces a different ciphertext/iv each time (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.notEqual(a.iv, b.iv);
  });

  it("rejects a tampered ciphertext", () => {
    const encrypted = encryptSecret("sensitive-value");
    const tampered = {
      ...encrypted,
      ciphertext: flipFirstByte(encrypted.ciphertext),
    };
    assert.throws(() => decryptSecret(tampered));
  });

  it("rejects a tampered auth tag", () => {
    const encrypted = encryptSecret("sensitive-value");
    const tampered = {
      ...encrypted,
      authTag: flipFirstByte(encrypted.authTag),
    };
    assert.throws(() => decryptSecret(tampered));
  });
});
