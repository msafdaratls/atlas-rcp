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

  it("tags new envelopes with the default key version", () => {
    const encrypted = encryptSecret("sensitive-value");
    assert.equal(encrypted.keyVersion, "v1");
  });
});

describe("key rotation", () => {
  it("decrypts an old-version envelope after the current version is rotated forward", () => {
    process.env.CREDENTIALS_MASTER_KEY_V2 = randomBytes(32).toString("base64");
    const encryptedUnderV1 = encryptSecret("pre-rotation-secret");

    process.env.CREDENTIALS_MASTER_KEY_VERSION = "v2";
    try {
      // A new save now uses v2...
      const encryptedUnderV2 = encryptSecret("post-rotation-secret");
      assert.equal(encryptedUnderV2.keyVersion, "v2");
      assert.equal(decryptSecret(encryptedUnderV2), "post-rotation-secret");

      // ...but the older v1 envelope, written before the rotation, still
      // decrypts correctly since its own keyVersion is preserved.
      assert.equal(decryptSecret(encryptedUnderV1), "pre-rotation-secret");
    } finally {
      delete process.env.CREDENTIALS_MASTER_KEY_VERSION;
      delete process.env.CREDENTIALS_MASTER_KEY_V2;
    }
  });

  it("throws a clear error when the key for an envelope's version is not configured", () => {
    assert.throws(
      () =>
        decryptSecret({
          ciphertext: "x",
          iv: "eA==",
          authTag: "eA==",
          keyVersion: "v9",
        }),
      /CREDENTIALS_MASTER_KEY_V9 is not set/,
    );
  });
});
