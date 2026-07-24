import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { SpacesStorage, readSpacesConfig } from "@/lib/storage/spaces";

export type StoredObject = {
  key: string;
  sizeBytes: number;
  mimeType: string;
};

/**
 * Storage backend contract. Production can swap in an S3 (or compatible)
 * adapter selected via `STORAGE_DRIVER` without changing callers — keep this
 * interface stable. Today only the local filesystem adapter is wired.
 *
 * When STORAGE_DRIVER=s3 is set without a configured adapter, getStorage()
 * fails closed rather than silently writing elsewhere.
 */
export interface StorageAdapter {
  put(input: {
    keyPrefix: string;
    fileName: string;
    mimeType: string;
    body: Buffer;
  }): Promise<StoredObject>;
  get(key: string): Promise<{ body: Buffer; mimeType: string } | null>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

/** Extension fallback only — never invent SVG from extension (XSS vector). */
function mimeFromExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function mimeSidecarPath(absolute: string): string {
  return `${absolute}.mime`;
}

export class LocalFilesystemStorage implements StorageAdapter {
  async put(input: {
    keyPrefix: string;
    fileName: string;
    mimeType: string;
    body: Buffer;
  }): Promise<StoredObject> {
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = path.posix.join(
      input.keyPrefix.replace(/^\/+|\/+$/g, ""),
      `${randomUUID()}-${safeName}`,
    );
    const absolute = path.join(UPLOAD_ROOT, key);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.body);
    const mimeType = input.mimeType || mimeFromExt(safeName);
    await writeFile(mimeSidecarPath(absolute), mimeType, "utf8");
    return {
      key,
      sizeBytes: input.body.byteLength,
      mimeType,
    };
  }

  async get(key: string): Promise<{ body: Buffer; mimeType: string } | null> {
    const absolute = path.join(UPLOAD_ROOT, key);
    try {
      const body = await readFile(absolute);
      let mimeType = mimeFromExt(key);
      try {
        const sidecar = await readFile(mimeSidecarPath(absolute), "utf8");
        const trimmed = sidecar.trim();
        if (trimmed) mimeType = trimmed;
      } catch {
        // no sidecar — fall back to extension mapping
      }
      return { body, mimeType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const absolute = path.join(UPLOAD_ROOT, key);
    try {
      await unlink(absolute);
    } catch {
      // ignore missing
    }
    try {
      await unlink(mimeSidecarPath(absolute));
    } catch {
      // ignore missing sidecar
    }
  }

  publicUrl(key: string): string {
    return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}

/**
 * Selects the storage backend from STORAGE_DRIVER:
 *   - "local"  (default) → LocalFilesystemStorage
 *   - "spaces"/"s3"       → SpacesStorage (DigitalOcean Spaces, S3-compatible)
 * Fails closed: an unknown driver, or "spaces" without credentials, throws
 * rather than silently writing to the wrong backend.
 */
function selectStorage(): StorageAdapter {
  const driver = (process.env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver === "local") return new LocalFilesystemStorage();
  if (driver === "spaces" || driver === "s3") {
    return new SpacesStorage(readSpacesConfig());
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}

let cachedStorage: StorageAdapter | null = null;

/** Memoised active adapter; config errors surface on first use, not at boot. */
export function getStorage(): StorageAdapter {
  if (!cachedStorage) cachedStorage = selectStorage();
  return cachedStorage;
}

/**
 * Stable facade used across the app. Delegates to the selected adapter so all
 * existing `import { storage }` call sites keep working after the driver swap.
 */
export const storage: StorageAdapter = {
  put: (input) => getStorage().put(input),
  get: (key) => getStorage().get(key),
  delete: (key) => getStorage().delete(key),
  publicUrl: (key) => getStorage().publicUrl(key),
};
