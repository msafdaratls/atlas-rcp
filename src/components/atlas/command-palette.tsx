"use client";

import type { Role } from "@prisma/client";
import { Command } from "cmdk";
import { Building2, FilePlus2, Receipt, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type CommandPaletteRequest = {
  id: string;
  requestNo: string;
  productName: string;
};

export type CommandPaletteClient = {
  id: string;
  name: string;
};

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests?: CommandPaletteRequest[];
  clients?: CommandPaletteClient[];
  /** When provided, client actions are gated by role. Omitted = show all (compat). */
  roles?: Role[];
  /** Base path prefix e.g. /ar/client or /ar/admin */
  basePath: string;
  mode: "client" | "admin";
};

function hasAnyRole(roles: Role[] | undefined, allowed: Role[]): boolean {
  if (!roles) return true;
  return allowed.some((role) => roles.includes(role));
}

export function CommandPalette({
  open,
  onOpenChange,
  requests = [],
  clients = [],
  roles,
  basePath,
  mode,
}: CommandPaletteProps) {
  const t = useTranslations("command");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const canNewRequest = hasAnyRole(roles, [
    "CLIENT_OWNER",
    "CLIENT_ADMIN",
    "CLIENT_USER",
  ]);
  const canOpenStatement = hasAnyRole(roles, [
    "CLIENT_OWNER",
    "CLIENT_ADMIN",
    "CLIENT_FINANCE",
  ]);
  const canAdminQueues = hasAnyRole(roles, [
    "INTAKE_OFFICER",
    "TECHNICAL_REVIEWER",
    "DECISION_MAKER",
    "SYSTEM_ADMIN",
    "QUALITY_MANAGER",
  ]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  function go(path: string) {
    onOpenChange(false);
    router.push(path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl [&>button]:hidden">
        <DialogTitle className="sr-only">{tCommon("commandPalette")}</DialogTitle>
        <Command
          className="flex max-h-[28rem] flex-col"
          label={tCommon("commandPalette")}
          shouldFilter
        >
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-ink-500" aria-hidden />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder={t("placeholder")}
              className="h-12 w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500"
              dir={locale === "ar" ? "rtl" : "ltr"}
            />
            <kbd className="hidden rounded border border-line bg-surface-alt px-1.5 py-0.5 font-data text-[10px] text-ink-500 sm:inline">
              ⌘K
            </kbd>
          </div>
          <Command.List className="overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-ink-500">
              {t("noResults")}
            </Command.Empty>

            <Command.Group
              heading={t("groupRequests")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-500"
            >
              {requests.map((request) => (
                <Command.Item
                  key={request.id}
                  value={`${request.requestNo} ${request.productName}`}
                  onSelect={() =>
                    go(
                      mode === "client"
                        ? `${basePath}/requests/${request.id}`
                        : `${basePath}/requests/${request.id}`,
                    )
                  }
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-ink-800 aria-selected:bg-atlas-green-tint",
                  )}
                >
                  <span className="font-data text-xs text-atlas-green-600" dir="ltr">
                    {request.requestNo}
                  </span>
                  <span className="truncate">{request.productName}</span>
                </Command.Item>
              ))}
            </Command.Group>

            {mode === "admin" ? (
              <Command.Group
                heading={t("groupClients")}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-500"
              >
                {clients.map((client) => (
                  <Command.Item
                    key={client.id}
                    value={client.name}
                    onSelect={() => go(`${basePath}/clients/${client.id}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-ink-800 aria-selected:bg-atlas-green-tint"
                  >
                    <Building2 className="size-4 text-ink-500" aria-hidden />
                    <span>{client.name}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ) : null}

            <Command.Group
              heading={t("groupActions")}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-500"
            >
              {mode === "client" ? (
                <>
                  {canNewRequest ? (
                    <Command.Item
                      value={t("actionNewRequest")}
                      onSelect={() => go(`${basePath}/requests/new`)}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-atlas-green-tint"
                    >
                      <FilePlus2 className="size-4 text-atlas-green" />
                      {t("actionNewRequest")}
                    </Command.Item>
                  ) : null}
                  {canOpenStatement ? (
                    <Command.Item
                      value={t("actionOpenStatement")}
                      onSelect={() => go(`${basePath}/statement`)}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-atlas-green-tint"
                    >
                      <Receipt className="size-4 text-atlas-green" />
                      {t("actionOpenStatement")}
                    </Command.Item>
                  ) : null}
                </>
              ) : canAdminQueues ? (
                <Command.Item
                  value={t("groupRequests")}
                  onSelect={() => go(`${basePath}/queues`)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm aria-selected:bg-atlas-green-tint"
                >
                  <Search className="size-4 text-atlas-green" />
                  {t("groupRequests")}
                </Command.Item>
              ) : null}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
