"use client";

// L3 skip: imported from client parents (tables, status-rail, request details).
// Converting to a Server Component would force those client boundaries to break.

import type { RequestState } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { STATE_META, STATE_TONE_CLASS } from "@/lib/request-state";
import { cn } from "@/lib/utils";

type StateBadgeProps = {
  state: RequestState;
  className?: string;
};

export function StateBadge({ state, className }: StateBadgeProps) {
  const t = useTranslations("states");
  const locale = useLocale();
  const meta = STATE_META[state];
  const Icon = meta.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        STATE_TONE_CLASS[meta.tone],
        className,
      )}
      lang={locale}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>{t(meta.labelKey)}</span>
    </span>
  );
}
