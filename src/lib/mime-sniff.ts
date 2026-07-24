/**
 * Magic-byte MIME sniffing for uploads. Never trust browser File.type alone.
 */

export type SniffedMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/svg+xml"
  | null;

export function sniffMime(body: Buffer): SniffedMime {
  if (body.length >= 5) {
    // %PDF-
    if (
      body[0] === 0x25 &&
      body[1] === 0x50 &&
      body[2] === 0x44 &&
      body[3] === 0x46
    ) {
      return "application/pdf";
    }
  }
  if (body.length >= 8) {
    // PNG
    if (
      body[0] === 0x89 &&
      body[1] === 0x50 &&
      body[2] === 0x4e &&
      body[3] === 0x47 &&
      body[4] === 0x0d &&
      body[5] === 0x0a &&
      body[6] === 0x1a &&
      body[7] === 0x0a
    ) {
      return "image/png";
    }
  }
  if (body.length >= 3) {
    // JPEG
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
      return "image/jpeg";
    }
  }
  if (body.length >= 12) {
    // RIFF....WEBP
    const riff = body.subarray(0, 4).toString("ascii");
    const webp = body.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }
  // SVG is text — detect by content prefix (disallow for security in callers)
  const head = body.subarray(0, Math.min(body.length, 256)).toString("utf8");
  const trimmed = head.trimStart().toLowerCase();
  if (
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<svg") ||
    trimmed.includes("<svg")
  ) {
    return "image/svg+xml";
  }
  return null;
}

export function mimeAllowed(
  sniffed: SniffedMime,
  allowlist: readonly string[],
): sniffed is NonNullable<SniffedMime> {
  return sniffed != null && allowlist.includes(sniffed);
}
