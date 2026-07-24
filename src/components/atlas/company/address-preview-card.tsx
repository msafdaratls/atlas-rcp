"use client";

// L3 skip: only imported from client company-profile-form.

import { useLocale, useTranslations } from "next-intl";
import { regionLabel } from "@/lib/saudi-regions";
import { cn } from "@/lib/utils";

type AddressPreviewCardProps = {
  nameEn: string;
  nameAr: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  nationalAddress?: string | null;
  crNumber?: string | null;
  vatNumber?: string | null;
  className?: string;
};

export function AddressPreviewCard({
  nameEn,
  nameAr,
  addressLine1,
  addressLine2,
  city,
  region,
  postalCode,
  country,
  nationalAddress,
  crNumber,
  vatNumber,
  className,
}: AddressPreviewCardProps) {
  const t = useTranslations("company");
  const locale = useLocale();
  const displayName = locale === "ar" ? nameAr || nameEn : nameEn || nameAr;

  return (
    <aside
      className={cn(
        "rounded-lg border border-line bg-surface-alt p-4 shadow-elevation",
        className,
      )}
      aria-label={t("address.previewTitle")}
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
        {t("address.previewTitle")}
      </p>
      <div className="space-y-1 text-sm text-ink-800">
        <p className="font-semibold text-ink-900">{displayName || "—"}</p>
        <p>{addressLine1 || "—"}</p>
        {addressLine2 ? <p>{addressLine2}</p> : null}
        <p>
          {[city, region ? regionLabel(region, locale) : null, postalCode]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
        <p>{country === "SA" ? t("address.saudiArabia") : country}</p>
        {nationalAddress ? (
          <p className="font-data text-xs text-ink-500" dir="ltr">
            {t("address.nationalAddress")}: {nationalAddress}
          </p>
        ) : null}
        {(crNumber || vatNumber) && (
          <div className="mt-3 space-y-0.5 border-t border-line pt-3 font-data text-xs text-ink-500">
            {crNumber ? (
              <p dir="ltr">
                {t("fields.crNumber")}: {crNumber}
              </p>
            ) : null}
            {vatNumber ? (
              <p dir="ltr">
                {t("fields.vatNumber")}: {vatNumber}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
