"use client";

import { formatStamp } from "@/lib/format";
import { DataTable } from "@/components/atlas/data-table";
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
import type { ClientRequestListItem } from "@/server/requests/queries";
import type { RequestState } from "@prisma/client";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

const STATE_FILTERS: Array<RequestState | "ALL"> = [
  "ALL",
  "DRAFT",
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

type Props = {
  rows: ClientRequestListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  q: string;
  state: string;
};

export function ClientRequestsTable({
  rows,
  page,
  pageSize,
  pageCount,
  q,
  state,
}: Props) {
  const t = useTranslations("myRequests");
  const tStates = useTranslations("states");
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

  const columns = useMemo<ColumnDef<ClientRequestListItem, unknown>[]>(
    () => [
      {
        id: "requestNo",
        header: t("columns.requestNo"),
        cell: ({ row }) => (
          <Link
            href={`/${locale}/client/requests/${row.original.id}`}
            className="inline-flex"
          >
            <RequestNumber value={row.original.requestNo} />
          </Link>
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
        id: "submission",
        header: t("columns.submission"),
        cell: ({ row }) => (
          <span className="font-data text-xs" dir="ltr">
            #{row.original.submissionNo}
          </span>
        ),
      },
      {
        id: "updated",
        header: t("columns.updated"),
        cell: ({ row }) => (
          <time className="font-data text-xs text-ink-500" dir="ltr">
            {formatStamp(row.original.updatedAt)}
          </time>
        ),
      },
      {
        id: "actions",
        header: t("columns.actions"),
        cell: ({ row }) => (
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/client/requests/${row.original.id}`}>
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
        <Select
          value={state || "ALL"}
          onValueChange={(value) =>
            pushParams({ state: value === "ALL" ? null : value, page: "1" })
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
