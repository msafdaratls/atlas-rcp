"use client";

import type { Role } from "@prisma/client";
import { Menu, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  CommandPalette,
  type CommandPaletteClient,
  type CommandPaletteRequest,
} from "@/components/atlas/command-palette";
import { NotificationBell } from "@/components/atlas/notification-bell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useOrganisationBrandingOptional } from "@/components/atlas/organisation-branding";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { NotificationListItem } from "@/server/notifications/queries";
import { logoutAction } from "@/server/auth/logout";

export type ShellUser = {
  name: string;
  email: string;
  organisationName: string;
  /** Client org logo URL/key for client shell; Atlas mark for admin. */
  organisationLogoUrl?: string | null;
};

type AppTopbarProps = {
  mode: "client" | "admin";
  basePath: string;
  user: ShellUser;
  roles?: Role[];
  unreadCount?: number;
  notifications?: NotificationListItem[];
  queueDepth?: number;
  onOpenMobileNav?: () => void;
  requests?: CommandPaletteRequest[];
  clients?: CommandPaletteClient[];
  className?: string;
};

function AtlasWordmark({ className }: { className?: string }) {
  const t = useTranslations("common");
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2 text-lg font-bold tracking-tight text-ink-900",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/atlas-mark.svg"
        alt={t("appName")}
        width={44}
        height={44}
        className="size-11"
      />
      <span>{t("appName")}</span>
    </Link>
  );
}

export function AppTopbar({
  mode,
  basePath,
  user,
  roles,
  unreadCount = 0,
  notifications = [],
  queueDepth = 0,
  onOpenMobileNav,
  requests = [],
  clients = [],
  className,
}: AppTopbarProps) {
  const [, startLogout] = useTransition();
  const t = useTranslations("common");
  const tShell = useTranslations("shell");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const branding = useOrganisationBrandingOptional();

  const organisationLogoUrl =
    branding?.organisationLogoUrl ?? user.organisationLogoUrl;
  const organisationName =
    branding?.organisationName ?? user.organisationName;


  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function switchLocale(next: Locale) {
    const path = window.location.pathname;
    const replaced = path.replace(/^\/(ar|en)(?=\/|$)/, `/${next}`);
    router.push(replaced);
  }

  const initials = organisationName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-surface px-3 sm:px-4",
          className,
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMobileNav}
          aria-label={t("openMenu")}
        >
          <Menu className="size-5" />
        </Button>

        {mode === "admin" ? (
          <div className="flex items-center gap-2">
            <AtlasWordmark />
            {queueDepth > 0 ? (
              <span className="rounded-full border border-line bg-atlas-green-tint px-2 py-0.5 font-data text-xs font-semibold text-atlas-green-600">
                {t("queueDepth", { count: queueDepth })}
              </span>
            ) : null}
          </div>
        ) : (
          <AtlasWordmark className="hidden sm:inline-flex" />
        )}

        <div className="ms-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:ms-4 sm:justify-between">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="relative hidden max-w-md flex-1 items-center md:flex"
            aria-label={t("commandPalette")}
          >
            <Search
              className="pointer-events-none absolute start-3 size-4 text-ink-500"
              aria-hidden
            />
            <Input
              readOnly
              tabIndex={-1}
              placeholder={tShell("globalSearchPlaceholder")}
              className="cursor-pointer pe-16 ps-9"
            />
            <kbd className="pointer-events-none absolute end-3 rounded border border-line bg-surface-alt px-1.5 py-0.5 font-data text-[10px] text-ink-500">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-1 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setPaletteOpen(true)}
              aria-label={t("commandPalette")}
            >
              <Search className="size-5" />
            </Button>

            <NotificationBell
              mode={mode}
              basePath={basePath}
              unreadCount={unreadCount}
              items={notifications}
            />

            <div
              className="flex items-center rounded-md border border-line p-0.5"
              role="group"
              aria-label="locale"
            >
              <Button
                type="button"
                size="sm"
                variant={locale === "ar" ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => switchLocale("ar")}
              >
                {t("localeAr")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={locale === "en" ? "default" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => switchLocale("en")}
              >
                {t("localeEn")}
              </Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 gap-2 px-1.5"
                  aria-label={t("userMenu")}
                >
                  <Avatar className="size-8">
                    {organisationLogoUrl ? (
                      <AvatarImage
                        src={organisationLogoUrl}
                        alt={organisationName}
                      />
                    ) : null}
                    <AvatarFallback>{initials || "OR"}</AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-[10rem] truncate text-start text-sm font-medium sm:block">
                    {user.name}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="space-y-0.5 font-normal">
                  <p className="font-semibold text-ink-900">{user.name}</p>
                  <p className="truncate text-xs text-ink-500">{user.email}</p>
                  <p className="truncate text-xs text-ink-500">
                    {organisationName}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link
                    href={
                      mode === "admin"
                        ? `${basePath}/settings`
                        : `${basePath}/company`
                    }
                  >
                    {t("profile")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    startLogout(() => {
                      void logoutAction(locale);
                    });
                  }}
                >
                  {t("signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        basePath={basePath}
        mode={mode}
        roles={roles}
        requests={requests}
        clients={clients}
      />
    </>
  );
}
