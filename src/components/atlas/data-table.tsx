"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type VisibilityState,
} from "@tanstack/react-table";
import { Download, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DataTableProps<TData> = {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  pageCount: number;
  pagination: PaginationState;
  onPaginationChange: (
    updater: PaginationState | ((old: PaginationState) => PaginationState),
  ) => void;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (
    updater: VisibilityState | ((old: VisibilityState) => VisibilityState),
  ) => void;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  filterSlot?: React.ReactNode;
  onExportCsv?: (rows: TData[]) => void;
  className?: string;
  /** Loading skeleton rows */
  loading?: boolean;
  /** Replaces default empty copy; include a primary action when useful */
  emptyState?: React.ReactNode;
  /** Error banner above the table — never pass raw server strings */
  errorMessage?: string | null;
  onRetry?: () => void;
};

export function DataTable<TData>({
  columns,
  data,
  pageCount,
  pagination,
  onPaginationChange,
  columnVisibility: controlledVisibility,
  onColumnVisibilityChange,
  globalFilter,
  onGlobalFilterChange,
  filterSlot,
  onExportCsv,
  className,
  loading = false,
  emptyState,
  errorMessage,
  onRetry,
}: DataTableProps<TData>) {
  const t = useTranslations("common");
  const [uncontrolledVisibility, setUncontrolledVisibility] =
    useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const visibility = controlledVisibility ?? uncontrolledVisibility;
  const setVisibility =
    onColumnVisibilityChange ?? setUncontrolledVisibility;

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      pagination,
      columnVisibility: visibility,
      columnFilters,
      globalFilter,
    },
    manualPagination: true,
    onPaginationChange,
    onColumnVisibilityChange: setVisibility,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const exportRows = useMemo(() => rows.map((row) => row.original), [rows]);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {onGlobalFilterChange ? (
            <Input
              value={globalFilter ?? ""}
              onChange={(event) => onGlobalFilterChange(event.target.value)}
              placeholder={t("search")}
              className="max-w-xs"
            />
          ) : null}
          {filterSlot}
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Settings2 className="size-4" />
                {t("columns")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t("columns")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(Boolean(value))
                    }
                    className="capitalize"
                  >
                    {column.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {onExportCsv ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onExportCsv(exportRows)}
            >
              <Download className="size-4" />
              {t("exportCsv")}
            </Button>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <div
          className="rounded-md border border-state-bad/40 bg-[color-mix(in_srgb,var(--state-bad)_8%,white)] px-3 py-2 text-sm text-state-bad"
          role="alert"
        >
          <p>{errorMessage}</p>
          {onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={onRetry}
            >
              {t("retry")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead className="bg-surface-alt text-start">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-line">
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} className="border-b border-line">
                  {columns.map((_, j) => (
                    <td key={`sk-${i}-${j}`} className="px-3 py-3">
                      <div className="h-3 animate-pulse rounded bg-line" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-ink-500"
                >
                  {emptyState ?? t("noResults")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 text-ink-800">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          {t("pageOf", {
            page: pagination.pageIndex + 1,
            pageCount: Math.max(pageCount, 1),
          })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            {t("previous")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            {t("next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
