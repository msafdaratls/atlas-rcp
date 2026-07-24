import path from "node:path";
import { randomUUID } from "node:crypto";

import { sha256Hex, signV4 } from "@/lib/storage/s3-signer";
import type { StorageAdapter, StoredObject } from "@/lib/storage/index";

export type SpacesConfig = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Endpoint host without bucket, e.g. "nyc3.digitaloceanspaces.com". */
  endpointHost: string;
};

/**
 * DigitalOcean Spaces (S3-compatible) storage. Objects are stored in a PRIVATE
 * bucket; downloads always go through the auth-gated /api/storage route, which
 * calls get() server-side — never a public bucket URL. Signing is done with the
 * dependency-free SigV4 signer (see s3-signer.ts).
 */
export class SpacesStorage implements StorageAdapter {
  constructor(private readonly cfg: SpacesConfig) {}

  private objectUrl(key: string): string {
    const encoded = key
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return `https://${this.cfg.bucket}.${this.cfg.endpointHost}/${encoded}`;
  }

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
    const url = this.objectUrl(key);
    const mimeType = input.mimeType || "application/octet-stream";

    const headers = signV4({
      method: "PUT",
      url,
      region: this.cfg.region,
      service: "s3",
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      headers: {
        "content-type": mimeType,
        "x-amz-acl": "private",
        "x-amz-content-sha256": sha256Hex(input.body),
      },
      body: input.body,
    });

    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: new Uint8Array(input.body),
    });
    if (!res.ok) {
      throw new Error(`SPACES_PUT_FAILED_${res.status}`);
    }

    return { key, sizeBytes: input.body.byteLength, mimeType };
  }

  async get(key: string): Promise<{ body: Buffer; mimeType: string } | null> {
    const url = this.objectUrl(key);
    const headers = signV4({
      method: "GET",
      url,
      region: this.cfg.region,
      service: "s3",
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      headers: { "x-amz-content-sha256": sha256Hex("") },
      body: "",
    });

    const res = await fetch(url, { method: "GET", headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`SPACES_GET_FAILED_${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return {
      body: Buffer.from(arrayBuffer),
      mimeType:
        res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const headers = signV4({
      method: "DELETE",
      url,
      region: this.cfg.region,
      service: "s3",
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      headers: { "x-amz-content-sha256": sha256Hex("") },
      body: "",
    });

    const res = await fetch(url, { method: "DELETE", headers });
    // 204 = deleted, 404 = already gone — both are success for us.
    if (!res.ok && res.status !== 404) {
      throw new Error(`SPACES_DELETE_FAILED_${res.status}`);
    }
  }

  publicUrl(key: string): string {
    // Always route through the auth-gated proxy; never expose the bucket URL.
    return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
}

/** Reads Spaces config from env; throws (fail closed) when incomplete. */
export function readSpacesConfig(): SpacesConfig {
  const region = process.env.SPACES_REGION;
  const bucket = process.env.SPACES_BUCKET;
  const accessKeyId = process.env.SPACES_KEY;
  const secretAccessKey = process.env.SPACES_SECRET;
  const endpointHost =
    process.env.SPACES_ENDPOINT?.replace(/^https?:\/\//, "").replace(/\/.*$/, "") ||
    (region ? `${region}.digitaloceanspaces.com` : undefined);

  if (!region || !bucket || !accessKeyId || !secretAccessKey || !endpointHost) {
    throw new Error(
      "STORAGE_DRIVER=spaces requires SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET",
    );
  }

  return { region, bucket, accessKeyId, secretAccessKey, endpointHost };
}
