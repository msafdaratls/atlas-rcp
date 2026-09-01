import type { Prisma } from "@prisma/client";

/** Same accept-list as generic document uploads, capped smaller since these are incidental evidence, not required submission documents. */
export const COMMENT_ATTACHMENT_ACCEPTED = [
  "application/pdf",
  "image/png",
  "image/jpeg",
];
export const COMMENT_ATTACHMENT_MAX_MB = 20;

export type CommentAttachment = {
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
};

export type AttachmentError = "MIME_REJECTED" | "FILE_TOO_LARGE" | "INFECTED_FILE";

/** Validates, virus-scans, and stores a comment/message attachment. Returns an error code instead of throwing so callers can map it to an ActionResult. */
export async function storeCommentAttachment(
  file: File,
  keyPrefix: string,
): Promise<{ ok: true; attachment: CommentAttachment } | { ok: false; error: AttachmentError }> {
  if (!COMMENT_ATTACHMENT_ACCEPTED.includes(file.type)) {
    return { ok: false, error: "MIME_REJECTED" };
  }
  if (file.size > COMMENT_ATTACHMENT_MAX_MB * 1024 * 1024) {
    return { ok: false, error: "FILE_TOO_LARGE" };
  }
  const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
  const { storage } = await import("@/lib/storage");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffMime(buffer);
  if (!mimeAllowed(sniffed, COMMENT_ATTACHMENT_ACCEPTED)) {
    return { ok: false, error: "MIME_REJECTED" };
  }
  const { getAvScanner } = await import("@/lib/av");
  const verdict = await getAvScanner().scan(buffer);
  if (verdict === "INFECTED") {
    return { ok: false, error: "INFECTED_FILE" };
  }
  const stored = await storage.put({
    keyPrefix,
    fileName: file.name,
    mimeType: sniffed,
    body: buffer,
  });
  return {
    ok: true,
    attachment: {
      fileName: file.name,
      storageKey: stored.key,
      sizeBytes: buffer.byteLength,
      mimeType: sniffed,
    },
  };
}

export function attachmentToJson(
  attachment: CommentAttachment | null,
): Prisma.InputJsonValue {
  return attachment ? [attachment as Prisma.InputJsonObject] : [];
}
