import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IN_FLIGHT_STATUSES } from "./concurrency";
import { STALL_RECOVERY } from "./recovery";

/**
 * The invariant these guard is the one the stuck-assessment bug violated: a
 * status that blocks starting a new run must always leave the reviewer some
 * way forward. CLASSIFYING blocked new runs while `confirmFieldsAndRun`
 * admitted only AWAITING_REVIEW, so a failed run stranded the item with no
 * route back and no UI to clear it.
 */
describe("stall recovery covers every status that blocks a new run", () => {
  it("decides a recovery for each in-flight status, with none left over", () => {
    assert.deepEqual(
      Object.keys(STALL_RECOVERY).sort(),
      [...IN_FLIGHT_STATUSES].sort(),
      "IN_FLIGHT_STATUSES and STALL_RECOVERY have drifted apart — a status that blocks new runs has no recovery decision",
    );
  });

  it("never recovers a status back into another blocking status the reviewer cannot act on", () => {
    const blocking = new Set<string>(IN_FLIGHT_STATUSES);
    const recovery: Record<string, string> = STALL_RECOVERY;
    for (const [status, target] of Object.entries(recovery)) {
      if (target === "reviewer-actionable") continue;
      assert.ok(
        !blocking.has(target) || recovery[target] === "reviewer-actionable",
        `${status} recovers to ${target}, which still blocks new runs and is not reviewer-actionable — that is the original stuck state with extra steps`,
      );
    }
  });

  it("returns a stalled classification to the reviewer rather than failing it outright", () => {
    // The confirmed field values survive a failed run, so re-running costs a
    // click; sending it to ERROR would throw that work away.
    assert.equal(STALL_RECOVERY.CLASSIFYING, "AWAITING_REVIEW");
  });

  it("fails a stalled extraction, because there are no fields to review yet", () => {
    assert.equal(STALL_RECOVERY.EXTRACTING, "ERROR");
    assert.ok(
      !(IN_FLIGHT_STATUSES as readonly string[]).includes("ERROR"),
      "ERROR must stay outside IN_FLIGHT_STATUSES or the reclaimed item still cannot be re-run",
    );
  });
});
