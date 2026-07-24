import { createHash, randomBytes } from "node:crypto";

export type UserFacingError = {
  /** Stable key for next-intl `errors.*` lookup */
  code: string;
  /** Short opaque reference for support (never the raw stack) */
  reference: string;
};

/**
 * Maps unexpected server errors to a safe user-facing code + reference.
 * Known domain codes (UNAUTHORIZED, FORBIDDEN, VALIDATION, …) pass through.
 * Everything else becomes UNEXPECTED with a reference; detail is for logs only.
 */
export function toUserFacingError(
  error: unknown,
  knownCodes: readonly string[] = KNOWN_ACTION_CODES,
): UserFacingError & { logDetail: string } {
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (knownCodes.includes(message)) {
    return { code: message, reference: "", logDetail: message };
  }

  const reference = `ATL-${randomBytes(3).toString("hex").toUpperCase()}`;
  const digest =
    error instanceof Error
      ? createHash("sha256").update(error.stack ?? error.message).digest("hex").slice(0, 8)
      : "00000000";

  return {
    code: "UNEXPECTED",
    reference,
    logDetail: `[${reference}/${digest}] ${message}`,
  };
}

export const KNOWN_ACTION_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION",
  "NOT_FOUND",
  "SAVE_FAILED",
  "EMAIL_TAKEN",
  "NO_FILE",
  "INVALID_LOGO",
  "INVALID_PROOF",
  "FILE_TOO_LARGE",
  "MIME_REJECTED",
  "DOC_SLOT_NOT_FOUND",
  "SERVICE_NOT_FOUND",
  "ALLOCATION_EXCEEDS_PAYMENT",
  "MANDATORY_DOCS_MISSING",
  "INFECTED_FILE",
  "CANNOT_DEMOTE_SELF",
  "CANNOT_DEACTIVATE_SELF",
  "INVALID_SAUDI_PHONE",
  "INVALID_VAT",
  "INVALID_POSTAL",
  "INVALID_NATIONAL_ADDRESS",
  "INVALID_URL",
] as const;

/** Server-side only — never surface raw detail to the client. */
export function logServerError(scope: string, detail: string): void {
  // Structured single-line log for operators; no PII beyond what the action already held.
  process.stderr.write(`[atlas:${scope}] ${detail}\n`);
}
