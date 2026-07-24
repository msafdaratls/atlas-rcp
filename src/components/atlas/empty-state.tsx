import type { LucideIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: LucideIcon;
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export async function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  const t = await getTranslations("empty");

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-surface-alt px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="flex size-12 items-center justify-center rounded-lg border border-line bg-surface text-atlas-green">
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <div className="max-w-md space-y-1">
        <h3 className="text-base font-semibold text-ink-900">
          {title ?? t("defaultTitle")}
        </h3>
        <p className="text-sm text-ink-500">
          {description ?? t("defaultDescription")}
        </p>
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
