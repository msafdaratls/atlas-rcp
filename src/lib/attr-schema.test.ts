import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateProductAttrs } from "@/lib/attr-schema";

const schema = {
  type: "object",
  required: ["batch"],
  properties: {
    batch: { type: "string", titleEn: "Batch", titleAr: "Batch" },
    weight: { type: "number", titleEn: "Weight", titleAr: "Weight" },
    organic: { type: "boolean", titleEn: "Organic", titleAr: "Organic" },
  },
};

describe("validateProductAttrs", () => {
  it("returns null for empty schema", () => {
    assert.equal(validateProductAttrs({}, { a: 1 }), null);
  });

  it("requires required fields", () => {
    assert.equal(validateProductAttrs(schema, {}), "ATTR_REQUIRED");
  });

  it("accepts valid attrs", () => {
    assert.equal(
      validateProductAttrs(schema, {
        batch: "B1",
        weight: 12.5,
        organic: true,
      }),
      null,
    );
  });

  it("rejects invalid number", () => {
    assert.equal(
      validateProductAttrs(schema, { batch: "B1", weight: "x" }),
      "ATTR_INVALID",
    );
  });
});
