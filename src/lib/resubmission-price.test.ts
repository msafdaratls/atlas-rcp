import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { resolveResubmissionPricePct } from "./resubmission-price";

const cataloguePct = new Prisma.Decimal("0.4");

describe("resolveResubmissionPricePct", () => {
  it("always charges CLIENT_FAULT when freeResubmissions is 0", () => {
    const pct = resolveResubmissionPricePct({
      fault: "CLIENT_FAULT",
      submissionNo: 2,
      freeResubmissions: 0,
      resubmissionPricePct: cataloguePct,
    });
    assert.equal(pct.equals(cataloguePct), true);
  });

  it("makes the first CLIENT_FAULT resubmit free when freeResubmissions is 1", () => {
    const pct = resolveResubmissionPricePct({
      fault: "CLIENT_FAULT",
      submissionNo: 2,
      freeResubmissions: 1,
      resubmissionPricePct: cataloguePct,
    });
    assert.equal(pct.isZero(), true);
  });

  it("charges the second CLIENT_FAULT resubmit when freeResubmissions is 1", () => {
    const pct = resolveResubmissionPricePct({
      fault: "CLIENT_FAULT",
      submissionNo: 3,
      freeResubmissions: 1,
      resubmissionPricePct: cataloguePct,
    });
    assert.equal(pct.equals(cataloguePct), true);
  });

  it("never charges ATLAS_FAULT", () => {
    const pct = resolveResubmissionPricePct({
      fault: "ATLAS_FAULT",
      submissionNo: 2,
      freeResubmissions: 0,
      resubmissionPricePct: cataloguePct,
    });
    assert.equal(pct.isZero(), true);
  });

  it("never charges REGULATORY_CHANGE", () => {
    const pct = resolveResubmissionPricePct({
      fault: "REGULATORY_CHANGE",
      submissionNo: 2,
      freeResubmissions: 0,
      resubmissionPricePct: cataloguePct,
    });
    assert.equal(pct.isZero(), true);
  });

  it("does not hardcode 0.5 — uses catalogue pct", () => {
    const custom = new Prisma.Decimal("0.25");
    const pct = resolveResubmissionPricePct({
      fault: "CLIENT_FAULT",
      submissionNo: 2,
      freeResubmissions: 0,
      resubmissionPricePct: custom,
    });
    assert.equal(pct.equals(custom), true);
    assert.equal(pct.equals(new Prisma.Decimal("0.5")), false);
  });
});
