import type { LabelEvalDomain } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
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
 */

/**
 * The only image types the Messages API accepts. Deliberately narrower than
 * the artwork upload slot's own allowlist, which also permits `image/tiff`
 * (prisma/seed.ts `labelMime`) — a TIFF artwork cannot be sent at all and is
 * skipped below rather than charged against the payload budget.
 */
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

async function buildDocumentContentBlocks(
  documents: ExtractionInputDocument[],
): Promise<Anthropic.Messages.ContentBlockParam[]> {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];
  let budgetUsed = 0;
  for (const doc of documents) {
    // Resolve sendability BEFORE reading or charging anything. A document
    // that can never become a content block must not consume budget on the
    // way past, or it silently crowds out a later document that would have
    // fit — the artwork slot accepts image/tiff, which is exactly such a
    // document. Same honest-gap outcome either way: the fields it covered
    // stay empty and needsReview.
    const isPdf = doc.mimeType === "application/pdf";
    const isImage = IMAGE_MIME_TYPES.has(doc.mimeType);
    if (!isPdf && !isImage) {
      log.warn("label-eval.extraction", "document mime type not supported for extraction; skipped", {
        storageKey: doc.storageKey,
        kind: doc.kind,
        mimeType: doc.mimeType,
      });
      continue;
    }

    const stored = await storage.get(doc.storageKey);
    if (!stored) continue; // unreadable copy — extraction proceeds with whatever else is available
    const encodedSize = base64Length(stored.body.length);

    // Skip rather than send a request the API will reject — both ceilings are
    // permanent 400s, which the worker would retry into a dead letter. Keep
    // going after a skip: a later, smaller document may still fit.
    const tooBigAlone = isImage && encodedSize > MAX_IMAGE_BASE64_BYTES;
    const tooBigTogether = budgetUsed + encodedSize > MAX_TOTAL_BASE64_BYTES;
    if (tooBigAlone || tooBigTogether) {
      log.warn("label-eval.extraction", "document too large to send for extraction; skipped", {
        storageKey: doc.storageKey,
        kind: doc.kind,
        rawBytes: stored.body.length,
        reason: tooBigAlone ? "per-image-limit" : "request-budget",
      });
      continue;
    }

    budgetUsed += encodedSize;
    const data = stored.body.toString("base64");
    if (isPdf) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: doc.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data },
      });
    }
  }
  return blocks;
}

export class ClaudeExtractionProvider implements ExtractionProvider {
  readonly name = "claude" as const;

  async extract(domain: LabelEvalDomain, documents: ExtractionInputDocument[]): Promise<ExtractedFieldResult[]> {
    const keys = allFieldKeys(domain);
    const documentBlocks = await buildDocumentContentBlocks(documents);

    if (documentBlocks.length === 0) {
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
    const parsed = await callStructured({
      scope: "label-eval.extraction",
      model,
      system:
        "You are a meticulous bilingual (Arabic/English) label-compliance data-extraction assistant. You transcribe exactly what is printed on the label; you never fabricate or infer a value that is not present.",
      content: [...documentBlocks, { type: "text", text: instructions }],
      schema: buildExtractionSchema(domain),
      effort: "medium",
    });

    return keys.map((key) => {
      const f = parsed.fields[key];
      const valueEn = f?.valueEn ?? undefined;
      const valueAr = f?.valueAr ?? undefined;
      const confidence = f?.confidence;
      // Design doc §1 Principle 3: Arabic and low-confidence fields are
      // always flagged for review regardless of what the provider reports —
      // enforced here in code, never taken on the model's word.
      const needsReview =
        !!valueAr || confidence === undefined || confidence < 0.7 || (!valueEn && !valueAr);
      return { fieldKey: key, valueEn, valueAr, confidence, needsReview };
    });
  }
}
