"use client";

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
import type { ClientReportListItem } from "@/server/requests/queries";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { Download, ExternalLink, ShieldCheck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

type Props = {
  rows: ClientReportListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  q: string;
  year: number;
  years: number[];
};

export function ClientReportsTable({
  rows,
  page,
  pageSize,
  pageCount,
  q,
  year,
  years,
}: Props) {
  const t = useTranslations("reports");
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

  const columns = useMemo<ColumnDef<ClientReportListItem, unknown>[]>(
    () => [
      {
        id: "requestNo",
        header: t("columns.requestNo"),
        cell: ({ row }) => <RequestNumber value={row.original.requestNo} />,
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
        id: "issuedAt",
        header: t("columns.issuedAt"),
        cell: ({ row }) => (
          <time className="font-data text-xs text-ink-500" dir="ltr">
            {row.original.issuedAt.slice(0, 10)}
          </time>
        ),
      },
      {
        id: "state",
        header: t("columns.state"),
        cell: ({ row }) => <StateBadge state={row.original.state} />,
      },
      {
        id: "actions",
        header: t("columns.actions"),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a
                href={`/api/reports/${row.original.id}/pdf?locale=${locale}`}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="size-4" />
                {t("download")}
              </a>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`/${locale}/client/requests/${row.original.id}`}>
                <ExternalLink className="size-4" />
                {t("open")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={`/${locale}/verify/${row.original.requestNo}`}>
                <ShieldCheck className="size-4" />
                {t("verify")}
              </Link>
            </Button>
          </div>
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
          value={String(year)}
          onValueChange={(value) => pushParams({ year: value, page: "1" })}
        >
          <SelectTrigger className="w-[8rem]">
            <SelectValue placeholder={t("year")} />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
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
