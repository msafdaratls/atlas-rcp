"use client";

import { useCallback, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

async function getCroppedBlob(
  imageSrc: string,
  crop: Area,
  mimeType: string,
): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () => reject(new Error("IMAGE_LOAD")));
    img.src = imageSrc;
  });

  const canvas = document.createElement("canvas");
  const size = Math.min(crop.width, crop.height, 512);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("CANVAS");
  }

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    size,
    size,
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("BLOB"));
          return;
        }
        resolve(blob);
      },
      mimeType === "image/png" ? "image/png" : "image/jpeg",
      0.92,
    );
  });
}

type LogoUploaderProps = {
  currentUrl: string | null;
  disabled?: boolean;
  onCropped: (file: File, previewUrl: string) => Promise<void>;
  className?: string;
};

export function LogoUploader({
  currentUrl,
  disabled,
  onCropped,
  className,
}: LogoUploaderProps) {
  const t = useTranslations("company");
  const [dragOver, setDragOver] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState("image/png");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  function resetCropper() {
    setSource(null);
    setCroppedArea(null);
    setZoom(1);
    setCrop({ x: 0, y: 0 });
  }

  async function handleFile(file: File) {
    setError(null);
    const allowed = ["image/png", "image/jpeg"];
    if (!allowed.includes(file.type)) {
      setError(t("logo.invalidType"));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t("logo.tooLarge"));
      return;
    }

    setMimeType(file.type);
    const reader = new FileReader();
    reader.onload = () => {
      setSource(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(file);
  }

  async function applyCrop() {
    if (!source || !croppedArea) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(source, croppedArea, mimeType);
      const file = new File(
        [blob],
        mimeType === "image/png" ? "logo.png" : "logo.jpg",
        { type: mimeType },
      );
      const previewUrl = URL.createObjectURL(blob);
      await onCropped(file, previewUrl);
      resetCropper();
    } catch {
      setError(t("logo.cropFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !disabled) void handleFile(file);
        }}
        className={cn(
          "rounded-lg border border-dashed border-line bg-surface-alt px-4 py-8 text-center transition-colors duration-150 ease-out",
          dragOver && "border-atlas-green bg-atlas-green-tint",
          disabled && "opacity-60",
        )}
      >
        <p className="text-sm font-semibold text-ink-900">{t("logo.dropTitle")}</p>
        <p className="mt-1 text-xs text-ink-500">{t("logo.dropHint")}</p>
        <label className="mt-4 inline-flex cursor-pointer">
          <span className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-800 hover:bg-atlas-green-tint">
            {t("logo.browse")}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            disabled={disabled || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-state-bad" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="mb-2 text-xs font-semibold text-ink-500">
            {t("logo.previewLight")}
          </p>
          <div className="flex h-16 items-center gap-2 rounded-md border border-line bg-surface px-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl ?? "/brand/client-demo-logo.svg"}
              alt=""
              className="size-9 rounded-md border border-line object-contain"
            />
            <span className="truncate text-sm font-semibold text-ink-900">
              {t("logo.topbarSample")}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-atlas-green p-3">
          <p className="mb-2 text-xs font-semibold text-white/80">
            {t("logo.previewGreen")}
          </p>
          <div className="flex h-16 items-center gap-2 rounded-md bg-atlas-green-600/40 px-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={currentUrl ?? "/brand/client-demo-logo.svg"}
              alt=""
              className="size-9 rounded-md border border-white/30 bg-white object-contain"
            />
            <span className="truncate text-sm font-semibold text-white">
              {t("logo.topbarSample")}
            </span>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(source)} onOpenChange={(open) => !open && resetCropper()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("logo.cropTitle")}</DialogTitle>
          </DialogHeader>
          <div className="relative h-64 overflow-hidden rounded-md bg-ink-900">
            {source ? (
              <Cropper
                image={source}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            ) : null}
          </div>
          <label className="flex items-center gap-3 text-sm text-ink-800">
            <span className="shrink-0">{t("logo.zoom")}</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetCropper}>
              {t("cancel")}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void applyCrop()}>
              {t("logo.applyCrop")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
