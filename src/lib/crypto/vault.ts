import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for secrets that must be recoverable in plaintext
 * (government-portal credentials for GHAD/SABER/FASAH — unlike password
 * hashes, these need to be reusable to actually log into the client's
 * account). Dependency-free, matching the native node:crypto style already
 * used for S3 request signing (src/lib/storage/s3-signer.ts) and token
 * hashing (src/lib/auth/tokens.ts).
 *
 * Keys are versioned so the master key can be rotated without re-encrypting
 * every row atomically. Each envelope records the `keyVersion` it was
 * encrypted under; decryption looks up that version's key, while encryption
 * always uses CREDENTIALS_MASTER_KEY_VERSION (default "v1").
 *
 * Version "v1" reads its key from CREDENTIALS_MASTER_KEY (unchanged env var,
 * so existing deployments need no changes). Any later version "vN" reads
 * CREDENTIALS_MASTER_KEY_VN. To rotate: generate a new key, set it as
 * CREDENTIALS_MASTER_KEY_V2 (keeping CREDENTIALS_MASTER_KEY / _V1 around so
 * existing rows still decrypt), set CREDENTIALS_MASTER_KEY_VERSION=v2, then
 * re-save each credential (decrypt-then-encrypt) to migrate it to v2 — after
 * which the old key can be retired. 32 raw bytes, base64-encoded.
 * Generate with: openssl rand -base64 32
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const DEFAULT_KEY_VERSION = "v1";

const keyCache = new Map<string, Buffer>();

function envVarForVersion(version: string): string {
  return version === DEFAULT_KEY_VERSION
    ? "CREDENTIALS_MASTER_KEY"
    : `CREDENTIALS_MASTER_KEY_${version.toUpperCase()}`;
}

function currentKeyVersion(): string {
  return process.env.CREDENTIALS_MASTER_KEY_VERSION ?? DEFAULT_KEY_VERSION;
}

function keyForVersion(version: string): Buffer {
  const cached = keyCache.get(version);
  if (cached) return cached;

  const envVar = envVarForVersion(version);
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(
      `${envVar} is not set — required to encrypt/decrypt platform credentials at key version "${version}"`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envVar} must decode to exactly 32 bytes (generate with: openssl rand -base64 32)`,
    );
  }
  keyCache.set(version, key);
  return key;
}

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const keyVersion = currentKeyVersion();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyForVersion(keyVersion), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

export function decryptSecret(input: EncryptedSecret): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    keyForVersion(input.keyVersion),
    Buffer.from(input.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(input.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(input.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
