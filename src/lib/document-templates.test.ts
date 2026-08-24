import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveTemplateChoice, type TemplateVariant } from "./document-templates";

const TEXTILE: TemplateVariant = {
  variantKey: "TEXTILE",
  url: "/api/storage/t/textile.docx",
  fileName: "Risk Assessment - textile.docx",
};
const PACKAGING: TemplateVariant = {
  variantKey: "PACKAGING",
  url: "/api/storage/t/packaging.docx",
  fileName: "Risk Assessment - packaging.docx",
};

describe("resolveTemplateChoice", () => {
  it("offers nothing when the slot has no template at all", () => {
    assert.deepEqual(resolveTemplateChoice({}), { kind: "none" });
  });

  it("offers the single template for a plain slot", () => {
    const choice = resolveTemplateChoice({
      templateUrl: "/api/storage/t/supplier.docx",
      templateFileName: "Supplier Declaration of Conformity.docx",
    });
    assert.deepEqual(choice, {
      kind: "single",
      url: "/api/storage/t/supplier.docx",
      fileName: "Supplier Declaration of Conformity.docx",
      variantKey: null,
    });
  });

  it("picks the variant matching the product's attribute", () => {
    const choice = resolveTemplateChoice(
      {
        templateVariantAttrKey: "technical_regulation",
        templateVariants: [TEXTILE, PACKAGING],
      },
      { technical_regulation: "PACKAGING" },
    );
    assert.deepEqual(choice, {
      kind: "single",
      url: PACKAGING.url,
      fileName: PACKAGING.fileName,
      variantKey: "PACKAGING",
    });
  });

  it("offers every form when the attribute has not been chosen", () => {
    // technical_regulation is optional on SAB-001, so this is the normal path
    // for anyone who skipped it — never leave the client with no form.
    const choice = resolveTemplateChoice(
      {
        templateVariantAttrKey: "technical_regulation",
        templateVariants: [TEXTILE, PACKAGING],
      },
      {},
    );
    assert.deepEqual(choice, { kind: "choose", variants: [TEXTILE, PACKAGING] });
  });

  it("offers every form when the attribute holds an unknown value", () => {
    const choice = resolveTemplateChoice(
      {
        templateVariantAttrKey: "technical_regulation",
        templateVariants: [TEXTILE, PACKAGING],
      },
      { technical_regulation: "RETIRED_REGULATION" },
    );
    assert.deepEqual(choice, { kind: "choose", variants: [TEXTILE, PACKAGING] });
  });

  it("ignores a non-string attribute value rather than throwing", () => {
    const choice = resolveTemplateChoice(
      {
        templateVariantAttrKey: "technical_regulation",
        templateVariants: [TEXTILE],
      },
      { technical_regulation: 42 },
    );
    assert.equal(choice.kind, "choose");
  });

  it("falls back to the single template when a variant slot has no variants", () => {
    // Between the migration landing and `db:templates` running, the slot is
    // flagged as variant-driven but the forms are not installed yet.
    const choice = resolveTemplateChoice(
      {
        templateUrl: "/api/storage/t/legacy.docx",
        templateFileName: "legacy.docx",
        templateVariantAttrKey: "technical_regulation",
        templateVariants: [],
      },
      {},
    );
    assert.deepEqual(choice, {
      kind: "single",
      url: "/api/storage/t/legacy.docx",
      fileName: "legacy.docx",
      variantKey: null,
    });
  });
});
