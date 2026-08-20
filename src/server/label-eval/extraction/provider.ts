import type { LabelDocumentKind, LabelEvalDomain } from "@prisma/client";
import { allFieldKeys } from "@/server/label-eval/fields";
import { ClaudeExtractionProvider } from "@/server/label-eval/extraction/claude-provider";

/**
 * Extraction provider contract (design doc §6/§10). Server-side only — never
 * imported by client code. Implementations may only EXTRACT facts; they must
 * never decide a verdict (design doc §1 Principle 1).
 */
export type ExtractionInputDocument = {
  kind: LabelDocumentKind;
  storageKey: string;
  mimeType: string;
};

export type ExtractedFieldResult = {
  fieldKey: string;
  valueEn?: string;
  valueAr?: string;
  confidence?: number;
  /** Arabic and low-confidence fields are always flagged for review regardless of what the provider reports (design doc §1 Principle 3). */
  needsReview: boolean;
};

export interface ExtractionProvider {
  readonly name: "manual" | "paddleocr_vl" | "google_vision" | "claude";
  extract(
    domain: LabelEvalDomain,
    documents: ExtractionInputDocument[],
  ): Promise<ExtractedFieldResult[]>;
}

/**
 * Always-available fallback: creates empty fields for every field key this
 * domain defines, all flagged needsReview so the reviewer fills them in by
 * hand at the verification gate. This is not a degraded mode — it is a
 * legitimate, fully-functional path (the design's own `sourceEngine` enum
 * already lists "manual" alongside the OCR engines) that exercises the
 * entire rest of the pipeline for real: verification gate → classification →
 * rule engine → scoring → report → promotion. Wiring in real OCR later is a
 * provider swap, not a UI change.
 */
export class ManualEntryProvider implements ExtractionProvider {
  readonly name = "manual" as const;

  async extract(domain: LabelEvalDomain): Promise<ExtractedFieldResult[]> {
    return allFieldKeys(domain).map((fieldKey) => ({
      fieldKey,
      needsReview: true,
    }));
  }
}

/**
 * NOT YET WIRED. The design calls for PaddleOCR-VL (EN/numeric/table
 * extraction) here. To activate: add a self-hosted PaddleOCR-VL inference
 * endpoint, set PADDLEOCR_VL_ENDPOINT, and implement `extract()` to call it
 * per input document, mapping its output onto the field keys in
 * src/server/label-eval/fields.ts. Selecting this provider without the env
 * var configured fails closed to ManualEntryProvider rather than silently
 * no-op'ing (see getExtractionProvider below) — never partially extract.
 */
export class PaddleOcrVlProvider implements ExtractionProvider {
  readonly name = "paddleocr_vl" as const;

  async extract(): Promise<ExtractedFieldResult[]> {
    throw new Error(
      "PaddleOcrVlProvider is not implemented — PADDLEOCR_VL_ENDPOINT integration pending.",
    );
  }
}

/**
 * NOT YET WIRED. The design calls for Google Cloud Vision
 * DOCUMENT_TEXT_DETECTION here for Arabic extraction. To activate: install
 * `@google-cloud/vision`, provision a service account, set
 * GOOGLE_APPLICATION_CREDENTIALS (server-side only — never client-exposed),
 * and implement `extract()`. Selecting this provider without the credential
 * configured fails closed to ManualEntryProvider (see getExtractionProvider
 * below).
 */
export class GoogleVisionProvider implements ExtractionProvider {
  readonly name = "google_vision" as const;

  async extract(): Promise<ExtractedFieldResult[]> {
    throw new Error(
      "GoogleVisionProvider is not implemented — GOOGLE_APPLICATION_CREDENTIALS integration pending.",
    );
  }
}

/**
 * Selects a provider from LABEL_EVAL_EXTRACTION_PROVIDER (manual | paddleocr_vl | google_vision | claude).
 * Defaults to "manual". Fails closed to manual entry if an unimplemented or
 * unconfigured provider is requested, rather than blocking assessment
 * entirely — a misconfigured env var must never stop a reviewer from
 * working. `new Anthropic()` (inside ClaudeExtractionProvider) only runs,
 * and ANTHROPIC_API_KEY only gets read, when this branch actually executes —
 * importing this module never constructs a client.
 */
export function getExtractionProvider(): ExtractionProvider {
  const requested = process.env.LABEL_EVAL_EXTRACTION_PROVIDER;
  if (requested === "paddleocr_vl" && process.env.PADDLEOCR_VL_ENDPOINT) {
    return new PaddleOcrVlProvider();
  }
  if (requested === "google_vision" && process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return new GoogleVisionProvider();
  }
  if (requested === "claude" && process.env.ANTHROPIC_API_KEY) {
    return new ClaudeExtractionProvider();
  }
  return new ManualEntryProvider();
}
