import type { LabelEvalDomain } from "@prisma/client";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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
  for (const doc of documents) {
    const stored = await storage.get(doc.storageKey);
    if (!stored) continue; // unreadable copy — extraction proceeds with whatever else is available
    const data = stored.body.toString("base64");
    if (doc.mimeType === "application/pdf") {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if (IMAGE_MIME_TYPES.has(doc.mimeType)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: doc.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data },
      });
    }
    // Any other mime type is skipped — the affected fields simply stay
    // unfilled and needsReview, same honest-gap behavior as a field the
    // model couldn't read.
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
