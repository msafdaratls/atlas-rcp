"use client";

import { Download } from "lucide-react";
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

  return (
    <div className="mt-1">
      <p className="text-xs text-ink-500">{chooseLabel}</p>
      <ul className="mt-1 flex flex-col gap-0.5">
        {choice.variants.map((v: TemplateVariant) => (
          <li key={v.variantKey}>
            <TemplateLink
              href={v.url}
              fileName={v.fileName}
              label={variantLabel(v.variantKey)}
            />
          </li>
        ))}
      </ul>
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
