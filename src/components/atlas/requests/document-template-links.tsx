"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import {
  resolveTemplateChoice,
  type TemplateSlot,
  type TemplateVariant,
} from "@/lib/document-templates";

type Props = TemplateSlot & {
  /** The product's own attribute values, used to resolve the variant. */
  productAttrs?: Record<string, unknown>;
  downloadLabel: string;
  /** Shown above the full list when the product has not picked a value yet. */
  chooseLabel: string;
  /** Translates a variant key into a human label (shared enums namespace). */
  variantLabel: (variantKey: string) => string;
};

/**
 * Renders the "Download template" affordance for one required-document slot.
 * The decision of which form(s) apply lives in resolveTemplateChoice so it can
 * be tested without rendering.
 */
export function DocumentTemplateLinks({
  productAttrs,
  downloadLabel,
  chooseLabel,
  variantLabel,
  ...slot
}: Props) {
  const choice = resolveTemplateChoice(slot, productAttrs);
  const [pickedVariantKey, setPickedVariantKey] = useState<string>("");

  if (choice.kind === "none") return null;

  if (choice.kind === "single") {
    return (
      <TemplateLink
        href={choice.url}
        fileName={choice.fileName ?? undefined}
        label={
          choice.variantKey
            ? `${downloadLabel} — ${variantLabel(choice.variantKey)}`
            : downloadLabel
        }
      />
    );
  }

  const picked = choice.variants.find((v) => v.variantKey === pickedVariantKey);

  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <p className="text-xs text-ink-500">{chooseLabel}</p>
      <select
        value={pickedVariantKey}
        onChange={(e) => setPickedVariantKey(e.target.value)}
        className="w-full max-w-xs rounded-md border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-700"
      >
        <option value="">—</option>
        {choice.variants.map((v: TemplateVariant) => (
          <option key={v.variantKey} value={v.variantKey}>
            {variantLabel(v.variantKey)}
          </option>
        ))}
      </select>
      {picked && (
        <TemplateLink
          href={picked.url}
          fileName={picked.fileName}
          label={`${downloadLabel} — ${variantLabel(picked.variantKey)}`}
        />
      )}
    </div>
  );
}

function TemplateLink({
  href,
  fileName,
  label,
}: {
  href: string;
  fileName?: string;
  label: string;
}) {
  return (
    <a
      href={href}
      download={fileName}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-atlas-green-600 underline-offset-2 hover:underline"
    >
      <Download className="size-3.5" />
      {label}
    </a>
  );
}
