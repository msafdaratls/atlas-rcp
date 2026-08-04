"use client";

import { Bell } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationListItem,
} from "@/server/notifications/queries";

const POLL_INTERVAL_MS = 30_000;

type Props = {
  mode: "client" | "admin";
  basePath: string;
  unreadCount: number;
  items: NotificationListItem[];
};

function dayKey(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function NotificationBell({
  mode,
  basePath,
  unreadCount,
  items,
}: Props) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const unreadCountRef = useRef(unreadCount);
  unreadCountRef.current = unreadCount;

  useEffect(() => {
    const interval = setInterval(async () => {
      const latest = await getUnreadNotificationCount();
      if (latest !== unreadCountRef.current) {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router]);

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

  function openItem(item: NotificationListItem) {
    startTransition(async () => {
      if (!item.readAt) await markNotificationRead(item.id);
      if (item.link) {
        router.push(`/${locale}${item.link}`);
      }
      router.refresh();
    });
  }

  function markAll() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("bellLabel")}
        >
          <Bell className="size-5" />
          {unreadCount > 0 ? (
            <span className="absolute end-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-state-bad px-1 font-data text-[10px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0">{t("title")}</DropdownMenuLabel>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending || unreadCount === 0}
            onClick={markAll}
          >
            {t("markAllRead")}
          </Button>
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-500">
              {t("empty")}
            </p>
          ) : (
            groups.map(([day, rows]) => (
              <div key={day}>
                <p className="bg-surface-alt px-3 py-1.5 text-xs font-semibold text-ink-500">
                  {day}
                </p>
                {rows.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    className={cn(
                      "flex cursor-pointer flex-col items-stretch gap-0.5 rounded-none px-3 py-2",
                      !item.readAt && "bg-atlas-green-tint",
                    )}
                    onSelect={(e) => {
                      e.preventDefault();
                      openItem(item);
                    }}
                  >
                    <span className="text-sm font-semibold text-ink-900">
                      {locale === "ar" ? item.titleAr : item.titleEn}
                    </span>
                    <span className="line-clamp-2 text-xs text-ink-500">
                      {locale === "ar" ? item.bodyAr : item.bodyEn}
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="p-2">
          <Button asChild variant="outline" className="w-full" size="sm">
            <Link href={`${basePath}/notifications`}>
              {t("viewAll")}
            </Link>
          </Button>
        </div>
        <span className="sr-only">{mode}</span>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
