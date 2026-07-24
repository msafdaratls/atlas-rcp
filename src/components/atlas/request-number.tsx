"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RequestNumberProps = {
  value: string;
  className?: string;
};

export function RequestNumber({ value, className }: RequestNumberProps) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      startTransition(() => {
        setCopied(true);
        toast.success(t("copied"));
        window.setTimeout(() => setCopied(false), 1500);
      });
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        void handleCopy();
      }}
      className={cn(
        "h-auto gap-1.5 px-1.5 py-1 font-data text-sm text-ink-900 hover:bg-atlas-green-tint",
        className,
      )}
      aria-label={value}
    >
      <span dir="ltr">{value}</span>
      {copied ? (
        <Check className="size-3.5 text-state-ok" aria-hidden />
      ) : (
        <Copy className="size-3.5 text-ink-500" aria-hidden />
      )}
    </Button>
  );
}
