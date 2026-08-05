"use client";

import { DataTable } from "@/components/atlas/data-table";
import { MessageSquare } from "lucide-react";
import { RequestNumber } from "@/components/atlas/request-number";
import { StateBadge } from "@/components/atlas/state-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AdminRequestListItem } from "@/server/admin/queries";
import type { RequestState } from "@prisma/client";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

const STATE_FILTERS: Array<RequestState | "ALL"> = [
  "ALL",
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "REPORT_ISSUED",
  "CLOSED",
  "ON_HOLD",
  "CANCELLED",
];

/** Mirrors `ADMIN_QUEUE_STATES` keys from `@/server/admin/queries` (kept as a
 * plain string list here so this client component never imports server-only
 * Prisma code). */
const QUEUE_FILTERS = [
  "intake",
  "assessment",
  "technical",
  "decision",
  "returned",
  "onHold",
] as const;

type Props = {
  rows: AdminRequestListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  q: string;
  state: string;
  queue: string;
};

export function AdminRequestsTable({
  rows,
  page,
  pageSize,
  pageCount,
  q,
  state,
  queue,
}: Props) {
  const t = useTranslations("adminOps.requests");
  const tStates = useTranslations("states");
  const tQueues = useTranslations("dashboard.admin.queues");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const pushParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => {
      router.push(`${pathname}?${next.toString()}`);
    });
  };

  const columns = useMemo<ColumnDef<AdminRequestListItem, unknown>[]>(
    () => [
      {
        id: "requestNo",
        header: t("columns.requestNo"),
        cell: ({ row }) => (
          <Link
            href={`/${locale}/admin/requests/${row.original.id}`}
            className="inline-flex"
          >
            <RequestNumber value={row.original.requestNo} />
          </Link>
        ),
      },
      {
        id: "client",
        header: t("columns.client"),
        cell: ({ row }) => (
          <span className="truncate text-ink-800">
            {locale === "ar" ? row.original.orgNameAr : row.original.orgNameEn}
          </span>
        ),
      },
      {
        id: "product",
        header: t("columns.product"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">
              {locale === "ar"
                ? row.original.productNameAr
                : row.original.productNameEn}
            </p>
            <p className="truncate text-xs text-ink-500">
              {locale === "ar"
                ? row.original.serviceNameAr
                : row.original.serviceNameEn}
            </p>
          </div>
        ),
      },
      {
        id: "state",
        header: t("columns.state"),
        cell: ({ row }) => <StateBadge state={row.original.state} />,
      },
      {
        id: "sla",
        header: t("columns.sla"),
        cell: ({ row }) => {
          const due = row.original.slaDueAt;
          if (!due) return <span className="text-xs text-ink-500">—</span>;
          const overdue = new Date(due).getTime() < Date.now();
          return (
            <time
              dir="ltr"
              className={
                overdue
                  ? "font-data text-xs font-semibold text-state-bad"
                  : "font-data text-xs text-ink-500"
              }
            >
              {due.slice(0, 16).replace("T", " ")}
            </time>
          );
        },
      },
      {
        id: "updated",
        header: t("columns.updated"),
        cell: ({ row }) => (
          <time className="font-data text-xs text-ink-500" dir="ltr">
            {row.original.updatedAt.slice(0, 16).replace("T", " ")}
          </time>
        ),
      },
      {
        id: "messages",
        header: t("columns.messages"),
        cell: ({ row }) => {
          const unread = row.original.unreadClientMessages;
          if (!unread) return null;
          return (
            <Link
              href={`/${locale}/admin/requests/${row.original.id}?openChat=1`}
              className="relative inline-flex"
              aria-label={t("columns.messages")}
            >
              <MessageSquare className="size-5 text-ink-500" />
              <span className="absolute -end-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-state-bad px-1 font-data text-[10px] font-semibold leading-none text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            </Link>
          );
        },
      },
      {
        id: "actions",
        header: t("columns.actions"),
        cell: ({ row }) => (
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/admin/requests/${row.original.id}`}>
              {t("open")}
            </Link>
          </Button>
        ),
      },
    ],
    [locale, t],
  );

  const pagination: PaginationState = {
    pageIndex: page - 1,
    pageSize,
  };

  return (
    <DataTable
      columns={columns}
      data={rows}
      pageCount={pageCount}
      pagination={pagination}
      loading={pending}
      globalFilter={q}
      onGlobalFilterChange={(value) =>
        pushParams({ q: value || null, page: "1" })
      }
      filterSlot={
        <>
          <Select
            value={state || "ALL"}
            onValueChange={(value) =>
              pushParams({
                state: value === "ALL" ? null : value,
                queue: null,
                page: "1",
              })
            }
          >
            <SelectTrigger className="w-[12rem]">
              <SelectValue placeholder={t("filterState")} />
            </SelectTrigger>
            <SelectContent>
              {STATE_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "ALL" ? t("allStates") : tStates(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={queue || "ALL"}
            onValueChange={(value) =>
              pushParams({
                queue: value === "ALL" ? null : value,
                state: null,
                page: "1",
              })
            }
          >
            <SelectTrigger className="w-[12rem]">
              <SelectValue placeholder={tQueues("intake")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allStates")}</SelectItem>
              {QUEUE_FILTERS.map((qKey) => (
                <SelectItem key={qKey} value={qKey}>
                  {tQueues(qKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      onPaginationChange={(updater) => {
        const next =
          typeof updater === "function" ? updater(pagination) : updater;
        pushParams({ page: String(next.pageIndex + 1) });
      }}
      emptyState={
        <p className="py-8 text-center text-sm text-ink-500">{t("empty")}</p>
      }
    />
  );
}
