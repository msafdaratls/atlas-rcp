"use client";

// L3 skip: only imported from client request-detail parents
// (admin-request-detail, client-request-detail).

import type { FaultAttribution, RequestState, ReturnReasonCode, Role } from "@prisma/client";
import { format } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { StateBadge } from "@/components/atlas/state-badge";
import { STATE_META, STATE_TONE_DOT } from "@/lib/request-state";
import { cn } from "@/lib/utils";

export type StatusRailEvent = {
  id: string;
  fromState: RequestState | null;
  toState: RequestState;
  actorName: string;
  actorRole: Role;
  note?: string | null;
  reasonCode?: ReturnReasonCode | null;
  faultAttribution?: FaultAttribution | null;
  createdAt: Date | string;
};

type StatusRailProps = {
  events: StatusRailEvent[];
  className?: string;
};

export function StatusRail({ events, className }: StatusRailProps) {
  const t = useTranslations("statusRail");
  const tStates = useTranslations("states");
  const tReasons = useTranslations("returnReasons");
  const locale = useLocale();
  const dateLocale = locale === "ar" ? arSA : enGB;

  if (events.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-line bg-surface-alt px-4 py-6 text-sm text-ink-500",
          className,
        )}
      >
        {t("empty")}
      </div>
    );
  }

  const ordered = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <section
      className={cn("rounded-lg border border-line bg-surface p-4", className)}
      aria-label={t("title")}
    >
      <h2 className="mb-4 text-sm font-semibold text-ink-900">{t("title")}</h2>
      <ol className="relative ms-3 border-s border-line ps-6">
        {ordered.map((event, index) => {
          const meta = STATE_META[event.toState];
          const isCurrent = index === ordered.length - 1;
          return (
            <li key={event.id} className="relative pb-6 last:pb-0">
              <span
                className={cn(
                  "absolute -start-[1.625rem] top-1 size-3 rounded-full border-2 border-surface",
                  STATE_TONE_DOT[meta.tone],
                  isCurrent &&
                    "ring-2 ring-atlas-green atlas-pulse ring-offset-2 ring-offset-surface",
                )}
                aria-hidden
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StateBadge state={event.toState} />
                    {event.fromState ? (
                      <span className="text-xs text-ink-500">
                        {tStates(event.fromState)} → {tStates(event.toState)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-ink-800">
                    {t("by", { name: event.actorName })}
                  </p>
                  {event.note ? (
                    <p className="text-sm text-ink-500">{event.note}</p>
                  ) : null}
                  {event.reasonCode ? (
                    <p className="text-xs text-ink-500">
                      <span className="font-semibold text-ink-800">
                        {t("reason")}:{" "}
                      </span>
                      {tReasons(event.reasonCode)}
                    </p>
                  ) : null}
                  {event.faultAttribution ? (
                    <p className="text-xs text-ink-500">
                      <span className="font-semibold text-ink-800">
                        {t("fault")}:{" "}
                      </span>
                      {t(event.faultAttribution)}
                    </p>
                  ) : null}
                </div>
                <time
                  className="shrink-0 font-data text-xs text-ink-500"
                  dateTime={new Date(event.createdAt).toISOString()}
                >
                  {format(new Date(event.createdAt), "PPp", {
                    locale: dateLocale,
                  })}
                </time>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
