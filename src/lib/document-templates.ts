/**
 * Decides which blank form(s) a required-document slot offers for one product.
 *
 * Most slots have at most one form. Some vary by a product attribute — SAB-001
 * accepts one risk assessment per product, but which blank form to fill
 * depends on that product's SABER technical regulation.
 */

export type TemplateVariant = {
  variantKey: string;
  url: string;
  fileName: string;
};

export type TemplateSlot = {
  templateUrl?: string | null;
  templateFileName?: string | null;
  templateVariantAttrKey?: string | null;
  templateVariants?: TemplateVariant[];
};

export type TemplateChoice =
  /** Nothing to download for this slot. */
  | { kind: "none" }
  /** Exactly one form applies — either a plain slot or a resolved variant. */
  | { kind: "single"; url: string; fileName: string | null; variantKey: string | null }
  /**
   * The slot varies by attribute but the product has not set it (the attribute
   * is optional), so every form is offered rather than none.
   */
  | { kind: "choose"; variants: TemplateVariant[] };

export function resolveTemplateChoice(
  slot: TemplateSlot,
  productAttrs?: Record<string, unknown>,
): TemplateChoice {
  const variants = slot.templateVariants ?? [];

  if (slot.templateVariantAttrKey && variants.length > 0) {
    const selected = productAttrs?.[slot.templateVariantAttrKey];
    const match =
      typeof selected === "string"
        ? variants.find((v) => v.variantKey === selected)
        : undefined;

    if (match) {
      return {
        kind: "single",
        url: match.url,
        fileName: match.fileName,
        variantKey: match.variantKey,
      };
    }
    return { kind: "choose", variants };
  }

  if (!slot.templateUrl) return { kind: "none" };

  return {
    kind: "single",
    url: slot.templateUrl,
    fileName: slot.templateFileName ?? null,
    variantKey: null,
  };
}
