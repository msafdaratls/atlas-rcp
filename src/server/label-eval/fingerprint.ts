import { createHash } from "node:crypto";

/**
 * Scalar, indexable fingerprint of a RequestItem's current source documents —
 * sha256 of the sorted, joined per-document sha256s. Drives the "needs
 * (re-)evaluation" queue check (design doc §2A.1): a resubmission with
 * replaced artwork produces a different fingerprint without any hook into
 * the request lifecycle. Order-independent by construction (sort first).
 */
export function computeDocumentsFingerprint(documentSha256s: string[]): string {
  const sorted = [...documentSha256s].sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex");
}
