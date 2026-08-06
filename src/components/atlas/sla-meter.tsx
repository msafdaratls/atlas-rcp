"use client";

// L3 skip: only imported from client request-detail parents
// (admin-request-detail, client-request-detail).

import type { RequestState } from "@prisma/client";
import { differenceInHours, differenceInMinutes } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type SlaMeterProps = {
  dueAt: Date | string | null | undefined;
  state: RequestState;
  /** When the SLA clock started (usually submittedAt). Defaults to 48h window ending at dueAt. */
  startedAt?: Date | string | null;
  className?: string;
};

function formatDuration(
  totalMinutes: number,
  locale: string,
  t: ReturnType<typeof useTranslations<"common">>,
): string {
  const abs = Math.abs(totalMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const nf = new Intl.NumberFormat(locale === "ar" ? "ar-SA" : "en-GB");
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remH = hours % 24;
    return t("slaUnits.dayHour", {
      days: nf.format(days),
      hours: nf.format(remH),
    });
  }
  if (hours > 0) {
    return (
      nf.format(hours) +
      t("slaUnits.h") +
      (minutes > 0 ? ` ${nf.format(minutes)}${t("slaUnits.m")}` : "")
    );
  }
  return nf.format(minutes) + t("slaUnits.m");
}

export function SlaMeter({ dueAt, state, startedAt, className }: SlaMeterProps) {
  const t = useTranslations("common");
  const locale = useLocale();
  const paused = state === "RETURNED_TO_CLIENT" || state === "ON_HOLD";

  // `now` is only known on the client, and differs from the server's render
  // time by however long the request took — using `new Date()` directly in
  // render causes a hydration mismatch. Render deterministically (as if
  // "now" were `start`) until mount, then swap in the real clock.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!dueAt) {
    return null;
  }

  const due = new Date(dueAt);
  const start = startedAt
    ? new Date(startedAt)
    : new Date(due.getTime() - 48 * 60 * 60 * 1000);
  const effectiveNow = now ?? start;
  const totalMs = Math.max(due.getTime() - start.getTime(), 1);
  const elapsedMs = Math.min(
    Math.max(effectiveNow.getTime() - start.getTime(), 0),
    totalMs * 2,
  );
  const progress = Math.min(elapsedMs / totalMs, 1);
  const minutesLeft = differenceInMinutes(due, effectiveNow);
  const overdue = minutesLeft < 0;
  const nearBreach = !overdue && progress >= 0.8;

  let fillClass = "bg-state-ok";
  if (paused) {
    fillClass = "bg-state-neutral/40";
  } else if (overdue) {
    fillClass = "bg-state-bad";
  } else if (nearBreach) {
    fillClass = "bg-state-warn";
  }

  const label = paused
    ? t("paused")
    : overdue
      ? t("overdue", { time: formatDuration(minutesLeft, locale, t) })
      : t("remaining", {
          time: formatDuration(
            differenceInHours(due, effectiveNow) * 60 +
              (Math.abs(minutesLeft) % 60),
            locale,
            t,
          ),
        });

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-500">
        <span className={cn(overdue && !paused && "font-semibold text-state-bad")}>
          {label}
        </span>
        <span className="font-data">
          {new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(due)}
        </span>
      </div>
      <div
        className={cn(
          "h-1.5 w-full overflow-hidden rounded-full border border-line bg-surface-alt",
          paused && "sla-hatch",
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-label={label}
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width,background-color] duration-150 ease-out",
            fillClass,
          )}
          style={{ width: `${Math.min(progress * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
