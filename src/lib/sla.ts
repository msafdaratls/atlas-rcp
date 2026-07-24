/**
 * SLA notification helpers — pause accounting + cycle-aware dedupe keys.
 */

export function slaDedupeKey(
  kind: "SLA_AT_RISK" | "SLA_BREACHED",
  requestId: string,
  submittedAt: Date,
): string {
  return `${kind}:${requestId}:${submittedAt.toISOString()}`;
}

export function slaNotifyLink(requestId: string, submittedAt: Date): string {
  return `/admin/requests/${requestId}?sla=${submittedAt.getTime()}`;
}

/**
 * When leaving a paused state, extend slaDueAt by the paused duration.
 * Returns null if there is nothing to adjust.
 */
export function resumeSlaDueAt(input: {
  slaDueAt: Date | null | undefined;
  slaPausedAt: Date | null | undefined;
  resumedAt?: Date;
}): Date | null {
  if (!input.slaDueAt || !input.slaPausedAt) return null;
  const resumedAt = input.resumedAt ?? new Date();
  const pausedMs = Math.max(
    0,
    resumedAt.getTime() - input.slaPausedAt.getTime(),
  );
  return new Date(input.slaDueAt.getTime() + pausedMs);
}
