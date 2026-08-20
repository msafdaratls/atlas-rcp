import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resumeSlaDueAt, slaDedupeKey, slaNotifyLink } from "@/lib/sla";

describe("resumeSlaDueAt", () => {
  it("returns null when there is no slaDueAt to adjust", () => {
    const result = resumeSlaDueAt({
      slaDueAt: null,
      slaPausedAt: new Date("2026-01-01T00:00:00Z"),
      resumedAt: new Date("2026-01-02T00:00:00Z"),
    });
    assert.equal(result, null);
  });

  it("returns null when the request was never paused", () => {
    const result = resumeSlaDueAt({
      slaDueAt: new Date("2026-01-05T00:00:00Z"),
      slaPausedAt: null,
      resumedAt: new Date("2026-01-02T00:00:00Z"),
    });
    assert.equal(result, null);
  });

  it("extends slaDueAt by exactly the paused duration", () => {
    const result = resumeSlaDueAt({
      slaDueAt: new Date("2026-01-05T00:00:00Z"),
      slaPausedAt: new Date("2026-01-01T00:00:00Z"),
      resumedAt: new Date("2026-01-03T00:00:00Z"), // paused 2 days
    });
    assert.equal(result?.toISOString(), new Date("2026-01-07T00:00:00Z").toISOString());
  });

  it("adds zero when resumed at the same instant it was paused", () => {
    const pausedAt = new Date("2026-01-01T12:00:00Z");
    const result = resumeSlaDueAt({
      slaDueAt: new Date("2026-01-05T00:00:00Z"),
      slaPausedAt: pausedAt,
      resumedAt: new Date(pausedAt),
    });
    assert.equal(result?.toISOString(), new Date("2026-01-05T00:00:00Z").toISOString());
  });

  it("clamps to zero instead of going negative if resumedAt precedes slaPausedAt (clock skew)", () => {
    const result = resumeSlaDueAt({
      slaDueAt: new Date("2026-01-05T00:00:00Z"),
      slaPausedAt: new Date("2026-01-03T00:00:00Z"),
      resumedAt: new Date("2026-01-01T00:00:00Z"), // "before" the pause — must not shrink the due date
    });
    assert.equal(result?.toISOString(), new Date("2026-01-05T00:00:00Z").toISOString());
  });

  it("defaults resumedAt to now when not provided", () => {
    const pausedAt = new Date(Date.now() - 1000);
    const result = resumeSlaDueAt({
      slaDueAt: new Date(Date.now() + 60_000),
      slaPausedAt: pausedAt,
    });
    assert.ok(result instanceof Date);
    // Extended by roughly the pause duration (~1s) — allow slack for test runtime.
    assert.ok(result!.getTime() >= Date.now() + 59_000);
  });
});

describe("slaDedupeKey / slaNotifyLink", () => {
  it("builds a stable key scoped to kind, request, and submission cycle", () => {
    const submittedAt = new Date("2026-01-01T00:00:00Z");
    assert.equal(
      slaDedupeKey("SLA_AT_RISK", "req-1", submittedAt),
      "SLA_AT_RISK:req-1:2026-01-01T00:00:00.000Z",
    );
  });

  it("produces a different key for a different submission cycle (resubmission)", () => {
    const first = slaDedupeKey("SLA_AT_RISK", "req-1", new Date("2026-01-01T00:00:00Z"));
    const resubmitted = slaDedupeKey("SLA_AT_RISK", "req-1", new Date("2026-01-02T00:00:00Z"));
    assert.notEqual(first, resubmitted);
  });

  it("builds a request link carrying the submission timestamp", () => {
    const submittedAt = new Date("2026-01-01T00:00:00Z");
    assert.equal(
      slaNotifyLink("req-1", submittedAt),
      `/admin/requests/req-1?sla=${submittedAt.getTime()}`,
    );
  });
});
