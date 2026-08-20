import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COSMETIC_SCOC_SERVICE_CODE,
  isSaberScocServiceCode,
  isScocServiceCode,
  SABER_SCOC_SERVICE_CODE,
} from "@/lib/scoc-services";

describe("isScocServiceCode", () => {
  it("is true for both the SABER and cosmetics SCOC codes", () => {
    assert.equal(isScocServiceCode(SABER_SCOC_SERVICE_CODE), true);
    assert.equal(isScocServiceCode(COSMETIC_SCOC_SERVICE_CODE), true);
  });

  it("is false for an unrelated service code", () => {
    assert.equal(isScocServiceCode("SAB-001"), false);
  });
});

describe("isSaberScocServiceCode", () => {
  it("is true only for the SABER variant, not the cosmetics one", () => {
    assert.equal(isSaberScocServiceCode(SABER_SCOC_SERVICE_CODE), true);
    assert.equal(isSaberScocServiceCode(COSMETIC_SCOC_SERVICE_CODE), false);
  });
});
