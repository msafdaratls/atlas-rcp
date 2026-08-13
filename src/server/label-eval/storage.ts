import type { LabelDocumentKind } from "@prisma/client";
import { storage } from "@/lib/storage";
import { prisma } from "@/lib/db";

/**
 * COPY-ON-INGEST, not a reference (design doc §3 / §13.5). Clients can
 * hard-delete RequestDocuments and their storage files while in
 * DRAFT/RETURNED_TO_CLIENT (src/server/requests/actions.ts:975-1005). If the
 * evaluator pointed at the request's storageKey, that delete could destroy
 * the artwork underpinning a completed assessment's audit trail. Every
 * document this feature evaluates is copied into an evaluator-owned prefix
 * and never deleted by this feature.
 */

export type IngestedDocument = {
  kind: LabelDocumentKind;
  sourceDocumentVersionId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  sha256: string;
};

/**
 * Copies every current-version document attached to a RequestItem, filtered
 * to the given RequiredDocument codes (mandatory artwork / ingredient list),
 * into evaluator-owned storage. Returns nothing written to the DB yet — the
 * caller persists these as LabelDocument rows inside the same transaction
 * that creates the LabelAssessment, so a failed copy never leaves an
 * assessment with a missing document silently.
 */
export async function ingestRequestItemDocuments(
  requestItemId: string,
  kindByRequiredDocumentCode: Record<string, LabelDocumentKind>,
): Promise<IngestedDocument[]> {
  const docs = await prisma.requestDocument.findMany({
    where: {
      requestItemId,
      requiredDocument: { code: { in: Object.keys(kindByRequiredDocumentCode) } },
    },
    select: {
      requiredDocument: { select: { code: true } },
      currentVersion: {
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sha256: true,
          storageKey: true,
        },
      },
    },
  });

  const ingested: IngestedDocument[] = [];
  for (const doc of docs) {
    const version = doc.currentVersion;
    const code = doc.requiredDocument?.code;
    if (!version || !code) continue;
    const kind = kindByRequiredDocumentCode[code];
    if (!kind) continue;

    const source = await storage.get(version.storageKey);
    if (!source) {
      throw new Error(`SOURCE_DOCUMENT_UNREADABLE:${version.id}`);
    }

    const copy = await storage.put({
      keyPrefix: "label-eval/documents",
      fileName: version.fileName,
      mimeType: version.mimeType,
      body: source.body,
    });

    ingested.push({
      kind,
      sourceDocumentVersionId: version.id,
      fileName: version.fileName,
      mimeType: version.mimeType,
      sizeBytes: copy.sizeBytes,
      storageKey: copy.key,
      sha256: version.sha256,
    });
  }
  return ingested;
}
