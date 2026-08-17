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

const arraySchema = {
  type: "object",
  required: ["certificates"],
  properties: {
    certificates: {
      type: "array",
      titleEn: "Certificates",
      titleAr: "Certificates",
      items: {
        type: "object",
        required: ["certificate_number", "models"],
        properties: {
          certificate_number: { type: "string", titleEn: "Certificate number", titleAr: "Certificate number" },
          models: { type: "string", titleEn: "Models", titleAr: "Models" },
        },
      },
    },
  },
};

describe("validateProductAttrs with array fields", () => {
  it("requires at least one entry when required", () => {
    assert.equal(validateProductAttrs(arraySchema, { certificates: [] }), "ATTR_REQUIRED");
    assert.equal(validateProductAttrs(arraySchema, {}), "ATTR_REQUIRED");
  });

  it("rejects a non-array value", () => {
    assert.equal(
      validateProductAttrs(arraySchema, { certificates: "PCOC-1" }),
      "ATTR_INVALID",
    );
  });

  it("requires each entry's required sub-fields", () => {
    assert.equal(
      validateProductAttrs(arraySchema, { certificates: [{ certificate_number: "PCOC-1" }] }),
      "ATTR_REQUIRED",
    );
  });

  it("accepts multiple valid entries", () => {
    assert.equal(
      validateProductAttrs(arraySchema, {
        certificates: [
          { certificate_number: "PCOC-1", models: "Model A" },
          { certificate_number: "PCOC-2", models: "Model B, Model C" },
        ],
      }),
      null,
    );
  });
});
