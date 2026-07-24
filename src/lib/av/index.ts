import { logServerError } from "@/lib/errors";
import { scanWithClamd, type AvVerdict } from "@/lib/av/clamav";

export type { AvVerdict } from "@/lib/av/clamav";

/**
 * Antivirus scanning for uploaded files. Driver selected by AV_DRIVER:
 *   - "none" (default) → NoopScanner: returns CLEAN (no scanner provisioned).
 *   - "clamav"         → streams the buffer to clamd (CLAMD_HOST/CLAMD_PORT).
 *
 * When clamd is unreachable the scan FAILS CLOSED (throws) so a malformed
 * deployment never silently accepts unscanned uploads.
 */
export interface AvScanner {
  scan(body: Buffer): Promise<AvVerdict>;
}

class NoopScanner implements AvScanner {
  async scan(): Promise<AvVerdict> {
    return "CLEAN";
  }
}

class ClamAvScanner implements AvScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  async scan(body: Buffer): Promise<AvVerdict> {
    try {
      return await scanWithClamd(body, { host: this.host, port: this.port });
    } catch (error) {
      logServerError(
        "av",
        `clamd scan failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
      throw new Error("AV_UNAVAILABLE");
    }
  }
}

let cached: AvScanner | null = null;

export function getAvScanner(): AvScanner {
  if (cached) return cached;
  const driver = (process.env.AV_DRIVER ?? "none").toLowerCase();
  if (driver === "clamav") {
    cached = new ClamAvScanner(
      process.env.CLAMD_HOST ?? "127.0.0.1",
      Number(process.env.CLAMD_PORT ?? "3310"),
    );
  } else {
    cached = new NoopScanner();
  }
  return cached;
}

/** True when a real scanner is configured (drives whether AV is enforced). */
export function avEnabled(): boolean {
  return (process.env.AV_DRIVER ?? "none").toLowerCase() !== "none";
}
