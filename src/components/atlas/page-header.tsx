import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type PageHeaderProps = {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  className?: string;
};

export async function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  const t = await getTranslations("common");

  return (
    <header
      className={cn(
        "mb-6 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="space-y-2">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label={t("breadcrumbs")}>
            <ol className="flex flex-wrap items-center gap-1 text-xs text-ink-500">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <span aria-hidden>/</span> : null}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="transition-colors duration-150 ease-out hover:text-atlas-green"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-ink-800">{crumb.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2" aria-label={t("actions")}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
