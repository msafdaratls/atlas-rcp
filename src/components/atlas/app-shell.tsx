"use client";

import type { Role } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/atlas/app-sidebar";
import {
  AppTopbar,
  type ShellUser,
} from "@/components/atlas/app-topbar";
import { AdminAssistantChat } from "@/components/atlas/assistant/admin-assistant-chat";
import { AssistantChat } from "@/components/atlas/assistant/assistant-chat";
import type {
  CommandPaletteClient,
  CommandPaletteRequest,
} from "@/components/atlas/command-palette";
import { OrganisationBrandingProvider } from "@/components/atlas/organisation-branding";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getNewRequestsCount } from "@/server/admin/actions";

const NEW_REQUESTS_POLL_INTERVAL_MS = 30_000;

type AppShellProps = {
  mode: "client" | "admin";
  locale: string;
  user: ShellUser;
  roles?: Role[];
  unreadCount?: number;
  notifications?: import("@/server/notifications/queries").NotificationListItem[];
  queueDepth?: number;
  newRequestsCount?: number;
  requests?: CommandPaletteRequest[];
  clients?: CommandPaletteClient[];
  children: React.ReactNode;
};

export function AppShell({
  mode,
  locale,
  user,
  roles,
  unreadCount = 0,
  notifications = [],
  queueDepth = 0,
  newRequestsCount = 0,
  requests,
  clients,
  children,
}: AppShellProps) {
  const t = useTranslations("common");
  const tShell = useTranslations("shell");
  const basePath = `/${locale}/${mode === "client" ? "client" : "admin"}`;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onResize() {
      setCollapsed(window.innerWidth < 1280 && window.innerWidth >= 1024);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const newRequestsCountRef = useRef(newRequestsCount);
  newRequestsCountRef.current = newRequestsCount;

  useEffect(() => {
    if (mode !== "admin") return;
    const interval = setInterval(async () => {
      const latest = await getNewRequestsCount();
      if (latest !== newRequestsCountRef.current) {
        router.refresh();
      }
    }, NEW_REQUESTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mode, router]);

  const shell = (
    <div className="flex min-h-screen flex-col bg-surface-alt">
      <AppTopbar
        mode={mode}
        basePath={basePath}
        user={user}
        roles={roles}
        unreadCount={unreadCount}
        notifications={notifications}
        queueDepth={queueDepth}
        onOpenMobileNav={() => setMobileOpen(true)}
        requests={requests}
        clients={clients}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">
          <AppSidebar
            mode={mode}
            basePath={basePath}
            roles={roles}
            collapsed={collapsed}
            newRequestsCount={newRequestsCount}
            className="sticky top-14 h-[calc(100vh-3.5rem)]"
          />
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="start" className="p-0">
            <SheetTitle className="sr-only">
              {mode === "client"
                ? tShell("clientWorkspace")
                : tShell("adminConsole")}
            </SheetTitle>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-base font-bold tracking-tight text-ink-900">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/atlas-mark.svg"
                alt={t("appName")}
                width={36}
                height={36}
                className="size-9"
              />
              {t("appName")}
            </div>
            <AppSidebar
              mode={mode}
              basePath={basePath}
              roles={roles}
              onNavigate={() => setMobileOpen(false)}
              newRequestsCount={newRequestsCount}
              className="border-e-0"
            />
          </SheetContent>
        </Sheet>

        <main
          className={cn(
            "min-w-0 flex-1 px-4 py-6 sm:px-6",
            collapsed
              ? "lg:max-w-[calc(100%-4.5rem)]"
              : "lg:max-w-[calc(100%-15rem)]",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );

  if (mode === "client") {
    return (
      <OrganisationBrandingProvider
        organisationName={user.organisationName}
        organisationLogoUrl={user.organisationLogoUrl}
      >
        {shell}
        <AssistantChat />
      </OrganisationBrandingProvider>
    );
  }

  return (
    <>
      {shell}
      <AdminAssistantChat />
    </>
  );
}
