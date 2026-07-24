"use client";

import { DataTable } from "@/components/atlas/data-table";
import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import type { AdminClientListItem } from "@/server/admin/queries";
import type { ColumnDef, PaginationState } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

type Props = {
  rows: AdminClientListItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  q: string;
};

export function AdminClientsTable({ rows, page, pageSize, pageCount, q }: Props) {
  const t = useTranslations("adminOps.clients");
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

  const columns = useMemo<ColumnDef<AdminClientListItem, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("columns.name"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink-900">
              {locale === "ar" ? row.original.nameAr : row.original.nameEn}
            </p>
            <p className="truncate text-xs text-ink-500" dir="ltr">
              {row.original.email}
            </p>
          </div>
        ),
      },
      {
        id: "balance",
        header: t("columns.balance"),
        cell: ({ row }) => <MoneyValue amount={row.original.balance} />,
      },
      {
        id: "creditLimit",
        header: t("columns.creditLimit"),
        cell: ({ row }) => <MoneyValue amount={row.original.creditLimit} />,
      },
      {
        id: "openRequests",
        header: t("columns.openRequests"),
        cell: ({ row }) => (
          <span className="font-data text-sm" dir="ltr">
            {row.original.openRequestCount}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("columns.actions"),
        cell: ({ row }) => (
          <Button asChild size="sm" variant="outline">
            <Link href={`/${locale}/admin/clients/${row.original.id}`}>
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
