"use client";

import { ChevronDown, Download, Eye, FileImage, FileText, FileType2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DocumentVersionView = {
  id: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string;
  uploadedAt: Date | string;
};

export type DocumentCardDoc = {
  id: string;
  label: string;
  currentVersion: DocumentVersionView | null;
  versions: DocumentVersionView[];
};

type DocumentCardProps = {
  doc: DocumentCardDoc;
  onDownload: (version: DocumentVersionView) => void;
  onPreview: (version: DocumentVersionView) => void;
  className?: string;
};

function FileGlyph({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) {
    return <FileImage className="size-5 text-atlas-green" aria-hidden />;
  }
  if (mimeType === "application/pdf") {
    return <FileText className="size-5 text-state-bad" aria-hidden />;
  }
  return <FileType2 className="size-5 text-ink-500" aria-hidden />;
}

function formatBytes(bytes: number, locale: string) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  }).format(bytes);
}

export function DocumentCard({
  doc,
  onDownload,
  onPreview,
  className,
}: DocumentCardProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const current = doc.currentVersion;
  const versions = [...doc.versions].sort((a, b) => b.version - a.version);

  if (!current) {
    return null;
  }

  return (
    <article
      className={cn(
        "rounded-lg border border-line bg-surface p-4 shadow-elevation",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-md border border-line bg-surface-alt">
          <FileGlyph mimeType={current.mimeType} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-ink-900">
              {doc.label}
            </h3>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-atlas-green-tint px-2 py-0.5 font-data text-xs font-semibold text-atlas-green-600 transition-colors duration-150 ease-out hover:bg-atlas-green/10"
              aria-expanded={open}
            >
              {t("version", { version: current.version })}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-150 ease-out",
                  open && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </div>
          <p className="truncate text-xs text-ink-500" dir="ltr">
            {current.fileName}
          </p>
          <p className="text-xs text-ink-500">
            {t("uploadedBy", { name: current.uploadedByName })} ·{" "}
            {t("fileSize", {
              size: formatBytes(current.sizeBytes, locale),
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onPreview(current)}
            aria-label={t("preview")}
          >
            <Eye className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDownload(current)}
            aria-label={t("download")}
          >
            <Download className="size-4" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold text-ink-900">
            {t("versionHistory")}
          </p>
          <ul className="space-y-2">
            {versions.map((version) => (
              <li
                key={version.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-alt px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-data text-xs font-semibold text-ink-900">
                    {t("version", { version: version.version })}
                  </p>
                  <p className="truncate text-xs text-ink-500" dir="ltr">
                    {version.fileName}
                  </p>
                  <p className="text-xs text-ink-500">
                    {t("uploadedBy", { name: version.uploadedByName })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onPreview(version)}
                  >
                    {t("preview")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => onDownload(version)}
                  >
                    {t("download")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
