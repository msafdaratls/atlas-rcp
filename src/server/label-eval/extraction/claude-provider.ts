import type { LabelEvalDomain } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { log } from "@/lib/logger";
import { storage } from "@/lib/storage";
import { LABEL_FIELD_DEFS, allFieldKeys } from "@/server/label-eval/fields";
import { callStructured } from "@/server/label-eval/llm/client";
import type {
  ExtractionInputDocument,
  ExtractedFieldResult,
  ExtractionProvider,
} from "@/server/label-eval/extraction/provider";

/**
 * Claude vision extraction provider (design doc §6/§10) — reads the copied
 * label artwork/ingredient-list documents directly (bilingual Arabic/English)
 * and returns structured field values via Claude's native structured
 * outputs. Selected by getExtractionProvider() only when
 * LABEL_EVAL_EXTRACTION_PROVIDER=claude and ANTHROPIC_API_KEY are both set;
 * unset either and the caller falls back to ManualEntryProvider (provider.ts).
 *
 * Nothing is silently dropped: an oversized or unsupported image is
 * downscaled/recompressed (or, for TIFF, transcoded to JPEG) to fit under
 * the API's per-image limit rather than skipped, and documents that still
 * don't all fit in one request's aggregate budget are split across multiple
 * sequential extraction calls whose per-field results are merged (highest
 * confidence wins) instead of some documents never being sent at all.
 */

/** Natively accepted by the Messages API — everything else is transcoded to JPEG first. */
const NATIVE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
/** Convertible via sharp into a natively-accepted format before sending. */
const CONVERTIBLE_IMAGE_MIME_TYPES = new Set(["image/tiff", "image/bmp", "image/heic", "image/heif"]);

/**
 * Ceiling on the base64 payload sent in one extraction call. The Messages
 * API rejects a request over 32 MB outright, and a document upload is
 * allowed up to ServiceItem.maxSizeMb (50 MB by default, next.config.ts's
 * bodySizeLimit) — so a single large artwork PDF can exceed it on its own
 * once base64 inflates it by 4/3. That rejection is a permanent 400: the
 * extraction worker would burn all three attempts on it and dead-letter the
 * assessment into ERROR. Budgeting here instead turns "too big to send" into
 * the same honest gap as an unreadable copy — the affected fields stay empty
 * and needsReview for the reviewer to fill in. 28 MB leaves headroom for the
 * instructions, system prompt, and response schema in the same request.
 */
export const MAX_TOTAL_BASE64_BYTES = 28 * 1024 * 1024;

/** The Messages API's hard per-request ceiling — what the budget above must stay under. */
export const ANTHROPIC_REQUEST_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * Per-image ceiling, which the aggregate budget above does NOT imply: a
 * single 12 MB PNG artwork sits well inside the 28 MB request budget and is
 * still rejected on its own. 10 MB is the limit for base64 images on the
 * Claude API, which is what getAnthropicClient() talks to; Bedrock and
 * Vertex cap the same field at 5 MB, so revisit this if the client is ever
 * repointed at a partner-operated platform. PDFs have no equivalent
 * per-document byte limit — the request cap is their only ceiling — so this
 * is checked for image blocks only.
 */
export const MAX_IMAGE_BASE64_BYTES = 10 * 1024 * 1024;

/** Exact base64 length of `n` raw bytes, without allocating the string. Exported for direct unit testing. */
export function base64Length(n: number): number {
  return Math.ceil(n / 3) * 4;
}

const extractedFieldSchema = z.object({
  valueEn: z.string().nullable(),
  valueAr: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

function buildExtractionSchema(domain: LabelEvalDomain) {
  const shape: Record<string, typeof extractedFieldSchema> = {};
  for (const key of allFieldKeys(domain)) shape[key] = extractedFieldSchema;
  return z.object({ fields: z.object(shape) });
}

type PreparedDocument = {
  kind: string;
  storageKey: string;
  isPdf: boolean;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string; // base64
  encodedSize: number;
};

/**
 * Recompresses/downscales an image until its base64 form fits under
 * `maxBytes`, instead of dropping it. Quality is stepped down first (cheap,
 * lossless to layout); once quality bottoms out, pixel dimensions are
 * stepped down too. A label photo only needs to stay legible to an OCR-grade
 * reader, not print-quality, so this trades resolution for completeness.
 */
async function fitImageToBudget(buffer: Buffer, maxBytes: number): Promise<{ mimeType: "image/jpeg"; data: string } | null> {
  const maxRawBytes = Math.floor((maxBytes / 4) * 3); // undo base64Length's 4/3 inflation
  const metadata = await sharp(buffer, { failOn: "none" }).metadata();
  let width = metadata.width ?? 4000;

  for (let quality = 90; quality >= 35; quality -= 15) {
    const out = await sharp(buffer, { failOn: "none" })
      .rotate() // apply EXIF orientation before resizing so nothing renders sideways
      .resize({ width: Math.min(width, 4000), withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (out.length <= maxRawBytes) return { mimeType: "image/jpeg", data: out.toString("base64") };
  }

  // Quality alone wasn't enough — keep shrinking dimensions at a fixed quality
  // until it fits or the image would become too small to be legible.
  for (let i = 0; i < 6; i++) {
    width = Math.round(width * 0.7);
    const out = await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 60, mozjpeg: true })
      .toBuffer();
    if (out.length <= maxRawBytes) return { mimeType: "image/jpeg", data: out.toString("base64") };
    if (width < 200) return { mimeType: "image/jpeg", data: out.toString("base64") };
  }
  return null;
}

async function prepareDocument(doc: ExtractionInputDocument): Promise<PreparedDocument | null> {
  const isPdf = doc.mimeType === "application/pdf";
  const isNativeImage = NATIVE_IMAGE_MIME_TYPES.has(doc.mimeType);
  const isConvertibleImage = CONVERTIBLE_IMAGE_MIME_TYPES.has(doc.mimeType);
  if (!isPdf && !isNativeImage && !isConvertibleImage) {
    log.warn("label-eval.extraction", "document mime type not supported for extraction; skipped", {
      storageKey: doc.storageKey,
      kind: doc.kind,
      mimeType: doc.mimeType,
    });
    return null;
  }

  const stored = await storage.get(doc.storageKey);
  if (!stored) return null; // unreadable copy — extraction proceeds with whatever else is available

  if (isPdf) {
    return {
      kind: doc.kind,
      storageKey: doc.storageKey,
      isPdf: true,
      mimeType: "image/jpeg", // unused for PDFs; source type is set at send time
      data: stored.body.toString("base64"),
      encodedSize: base64Length(stored.body.length),
    };
  }

  const rawEncodedSize = base64Length(stored.body.length);
  if (isNativeImage && rawEncodedSize <= MAX_IMAGE_BASE64_BYTES) {
    return {
      kind: doc.kind,
      storageKey: doc.storageKey,
      isPdf: false,
      mimeType: doc.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: stored.body.toString("base64"),
      encodedSize: rawEncodedSize,
    };
  }

  // Oversized native image or a convertible format (TIFF/BMP/HEIC/HEIF):
  // recompress rather than skip so every artwork photo still gets read.
  const fitted = await fitImageToBudget(stored.body, MAX_IMAGE_BASE64_BYTES);
  if (!fitted) {
    log.error("label-eval.extraction", "document could not be recompressed under the per-image limit; skipped", {
      storageKey: doc.storageKey,
      kind: doc.kind,
      rawBytes: stored.body.length,
    });
    return null;
  }
  return {
    kind: doc.kind,
    storageKey: doc.storageKey,
    isPdf: false,
    mimeType: fitted.mimeType,
    data: fitted.data,
    encodedSize: base64Length(Buffer.byteLength(fitted.data, "base64")),
  };
}

function toContentBlock(doc: PreparedDocument): Anthropic.Messages.ContentBlockParam {
  return doc.isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data } }
    : { type: "image", source: { type: "base64", media_type: doc.mimeType, data: doc.data } };
}

/**
 * Greedily bins prepared documents into requests that each stay under the
 * aggregate payload budget, instead of dropping whatever doesn't fit in one
 * request. A single document that alone exceeds the budget (a very large PDF
 * — images are already recompressed under the per-image cap by this point)
 * is still sent on its own as a best effort rather than dropped.
 */
function batchDocuments(docs: PreparedDocument[], maxBytesPerBatch: number): PreparedDocument[][] {
  const batches: PreparedDocument[][] = [];
  let current: PreparedDocument[] = [];
  let currentSize = 0;
  for (const doc of docs) {
    if (current.length > 0 && currentSize + doc.encodedSize > maxBytesPerBatch) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(doc);
    currentSize += doc.encodedSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export class ClaudeExtractionProvider implements ExtractionProvider {
  readonly name = "claude" as const;

  async extract(domain: LabelEvalDomain, documents: ExtractionInputDocument[]): Promise<ExtractedFieldResult[]> {
    const keys = allFieldKeys(domain);
    const prepared = (await Promise.all(documents.map(prepareDocument))).filter(
      (d): d is PreparedDocument => d !== null,
    );

    if (prepared.length === 0) {
      // No readable document content — fail closed the same way
      // ManualEntryProvider does: every field flagged for review rather than
      // a fabricated extraction.
      return keys.map((key) => ({ fieldKey: key, needsReview: true }));
    }

    const fieldList = LABEL_FIELD_DEFS[domain]
      .map((f) => `- ${f.key}: ${f.labelEn} / ${f.labelAr}`)
      .join("\n");

    const instructions = `You are extracting label data from the attached product artwork / ingredient-list images for a regulatory compliance review. Read every field listed below directly off the label images, in both English and Arabic where the label prints them. Fields:\n${fieldList}\n\nFor each field return valueEn (the English text if printed, else null), valueAr (the Arabic text if printed, else null), and confidence (0-1: your honest certainty the value is complete and correctly read). If a field is not visible anywhere on the label, return null for both languages and a low confidence — never guess or infer a value that is not actually printed on the label.`;

    const model = process.env.LABEL_EVAL_CLAUDE_EXTRACTION_MODEL || "claude-sonnet-5";
    const schema = buildExtractionSchema(domain);

    // Every prepared document is under the per-image cap, but the whole set
    // may still exceed one request's aggregate budget — split across
    // sequential calls rather than drop any of them, and merge per-field
    // results below (highest confidence wins) instead of only keeping one
    // batch's view of the label.
    const batches = batchDocuments(prepared, MAX_TOTAL_BASE64_BYTES);
    const batchResults: z.infer<ReturnType<typeof buildExtractionSchema>>[] = [];
    for (const batch of batches) {
      const parsed = await callStructured({
        scope: "label-eval.extraction",
        model,
        system:
          "You are a meticulous bilingual (Arabic/English) label-compliance data-extraction assistant. You transcribe exactly what is printed on the label; you never fabricate or infer a value that is not present.",
        content: [...batch.map(toContentBlock), { type: "text", text: instructions }],
        schema,
        effort: "medium",
        // The shared client's default is 45s (anthropic-client.ts), tuned for
        // the chat path's short text turns. This call can carry up to
        // MAX_TOTAL_BASE64_BYTES (28 MB) of documents/images, which routinely
        // exceeds that — and a client-side timeout doesn't cancel or refund
        // the server-side call, so a too-short timeout here means paying for
        // the same oversized vision call up to 3 times (SDK default retries)
        // before the worker's own retry even kicks in.
        timeoutMs: 180_000,
      });
      batchResults.push(parsed);
    }

    return keys.map((key) => {
      // Each batch only saw a subset of the label's documents, so a field
      // may come back populated from one batch and empty from another —
      // keep whichever batch was most confident about this specific field.
      let best: { valueEn?: string | null; valueAr?: string | null; confidence?: number } | undefined;
      for (const parsed of batchResults) {
        const f = parsed.fields[key];
        if (!f) continue;
        const better =
          !best ||
          (f.confidence ?? -1) > (best.confidence ?? -1) ||
          (best.valueEn == null && best.valueAr == null && (f.valueEn != null || f.valueAr != null));
        if (better) best = f;
      }
      const valueEn = best?.valueEn ?? undefined;
      const valueAr = best?.valueAr ?? undefined;
      const confidence = best?.confidence;
      // Design doc §1 Principle 3: Arabic and low-confidence fields are
      // always flagged for review regardless of what the provider reports —
      // enforced here in code, never taken on the model's word.
      const needsReview =
        !!valueAr || confidence === undefined || confidence < 0.7 || (!valueEn && !valueAr);
      return { fieldKey: key, valueEn, valueAr, confidence, needsReview };
    });
  }
}
