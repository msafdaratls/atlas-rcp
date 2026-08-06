import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets that must be recoverable in plaintext
 * (government-portal credentials for GHAD/SABER/FASAH — unlike password
 * hashes, these need to be reusable to actually log into the client's
 * account). Dependency-free, matching the native node:crypto style already
 * used for S3 request signing (src/lib/storage/s3-signer.ts) and token
 * hashing (src/lib/auth/tokens.ts).
 *
 * Key comes from CREDENTIALS_MASTER_KEY: 32 raw bytes, base64-encoded.
 * Generate with: openssl rand -base64 32
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CREDENTIALS_MASTER_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY is not set — required to store/read platform credentials",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIALS_MASTER_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)",
    );
  }
  cachedKey = key;
  return key;
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(input: EncryptedSecret): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    masterKey(),
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
