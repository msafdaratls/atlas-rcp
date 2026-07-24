"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListItem,
} from "@/server/notifications/queries";

type Props = {
  items: NotificationListItem[];
};

function dayKey(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function timeLabel(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function NotificationCentre({ items }: Props) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, NotificationListItem[]>();
    for (const item of items) {
      const key = dayKey(new Date(item.createdAt), locale);
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [items, locale]);

  const unread = items.filter((i) => !i.readAt).length;

  function openItem(item: NotificationListItem) {
    startTransition(async () => {
      if (!item.readAt) await markNotificationRead(item.id);
      if (item.link) router.push(`/${locale}${item.link}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-500">
          {t("unreadCount", { count: unread })}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || unread === 0}
          onClick={() =>
            startTransition(async () => {
              await markAllNotificationsRead();
              router.refresh();
            })
          }
        >
          {t("markAllRead")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface-alt px-4 py-10 text-center text-sm text-ink-500">
          {t("empty")}
        </div>
      ) : (
        groups.map(([day, rows]) => (
          <section key={day} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              {day}
            </h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {rows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-4 py-3 text-start transition-colors duration-150 ease-out hover:bg-surface-alt",
                      !item.readAt && "bg-atlas-green-tint",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-ink-900">
                        {locale === "ar" ? item.titleAr : item.titleEn}
                      </p>
                      <time
                        className="shrink-0 font-data text-xs text-ink-500"
                        dateTime={new Date(item.createdAt).toISOString()}
                      >
                        {timeLabel(new Date(item.createdAt), locale)}
                      </time>
                    </div>
                    <p className="text-sm text-ink-800">
                      {locale === "ar" ? item.bodyAr : item.bodyEn}
                    </p>
                    {item.link ? (
                      <Link
                        href={`/${locale}${item.link}`}
                        className="text-xs font-semibold text-atlas-green-600"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t("openLink")}
                      </Link>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
