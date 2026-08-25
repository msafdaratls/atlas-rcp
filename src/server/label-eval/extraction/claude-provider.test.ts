import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANTHROPIC_REQUEST_LIMIT_BYTES,
  MAX_IMAGE_BASE64_BYTES,
  MAX_TOTAL_BASE64_BYTES,
  base64Length,
} from "./claude-provider";

describe("extraction payload budget — keeps one request under the Messages API cap", () => {
  it("computes the same base64 length Buffer.toString('base64') produces", () => {
    // The budget is charged before the string is allocated, so the estimate
    // has to be exact rather than approximate — including at each of the
    // three padding remainders.
    for (const n of [0, 1, 2, 3, 4, 5, 6, 100, 1023, 1024, 65_536]) {
      assert.equal(
        base64Length(n),
        Buffer.alloc(n).toString("base64").length,
        `base64Length(${n}) must match the real encoder`,
      );
    }
  });

  it("leaves headroom under the API's hard per-request limit", () => {
    // The documents are not the whole request: the instructions, system
    // prompt and response schema ride along in the same call. A budget set
    // at or above the API limit would send requests that the API rejects
    // with a permanent 400, which the worker retries into a dead letter.
    assert.ok(
      MAX_TOTAL_BASE64_BYTES < ANTHROPIC_REQUEST_LIMIT_BYTES,
      "document budget must stay strictly under the request limit",
    );
    assert.ok(
      ANTHROPIC_REQUEST_LIMIT_BYTES - MAX_TOTAL_BASE64_BYTES >= 2 * 1024 * 1024,
      "leave at least 2 MB for the prompt and schema sharing the request",
    );
  });

  it("admits a realistic label PDF and rejects one that cannot fit", () => {
    const fourMbPdf = 4 * 1024 * 1024;
    assert.ok(base64Length(fourMbPdf) < MAX_TOTAL_BASE64_BYTES, "a normal artwork PDF must still be sent");

    // ServiceItem.maxSizeMb defaults to 50 MB, so an upload this size is
    // accepted by the platform and must be skipped here rather than sent.
    const fiftyMbPdf = 50 * 1024 * 1024;
    assert.ok(base64Length(fiftyMbPdf) > MAX_TOTAL_BASE64_BYTES, "a max-size upload must not be sent");
  });

  it("caps a single image well below the request budget", () => {
    // The aggregate budget does not imply the per-image one. A 12 MB PNG
    // sits comfortably inside 28 MB and is still rejected on its own, so a
    // request-level budget alone would let it through to a permanent 400.
    const twelveMbPng = base64Length(12 * 1024 * 1024);
    assert.ok(twelveMbPng < MAX_TOTAL_BASE64_BYTES, "it fits the aggregate budget");
    assert.ok(twelveMbPng > MAX_IMAGE_BASE64_BYTES, "but must still be rejected per-image");
  });

  it("uses the direct-API per-image limit, not the stricter partner-platform one", () => {
    // 10 MB is the Claude API limit; Bedrock and Vertex cap the same field at
    // 5 MB. Picking the partner number here would needlessly drop artwork
    // this deployment can actually send.
    assert.equal(MAX_IMAGE_BASE64_BYTES, 10 * 1024 * 1024);
    assert.ok(MAX_IMAGE_BASE64_BYTES < MAX_TOTAL_BASE64_BYTES, "one image can never fill the request alone");
  });

  it("charges base64 inflation, not the raw size — the 4/3 factor is the whole point", () => {
    // 24 MB of raw bytes is under the 28 MB budget, but base64 pushes it to
    // 32 MB. Budgeting on raw size would send a request the API rejects.
    const rawUnderBudget = 24 * 1024 * 1024;
    assert.ok(rawUnderBudget < MAX_TOTAL_BASE64_BYTES, "raw size alone looks like it fits");
    assert.ok(base64Length(rawUnderBudget) > MAX_TOTAL_BASE64_BYTES, "encoded size must not fit");
  });
});
