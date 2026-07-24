"use client";

import { useLocale } from "next-intl";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  const locale = useLocale();
  return (
    <Sonner
      position={locale === "ar" ? "top-left" : "top-right"}
      richColors
      closeButton
    />
  );
}
