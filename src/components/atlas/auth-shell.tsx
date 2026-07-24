import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { LocaleSwitch } from "@/components/atlas/locale-switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Shared frame for the public auth screens (login / signup).
 * Provides the Atlas brand mark, a language toggle, and a centred card.
 */
export async function AuthShell({
  locale,
  title,
  subtitle,
  children,
  footer,
}: {
  locale: "ar" | "en";
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const tCommon = await getTranslations("common");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/atlas-mark.svg"
            alt={tCommon("appName")}
            width={64}
            height={64}
            className="size-16 rounded-xl"
          />
          <span className="text-xl font-bold tracking-tight text-[var(--ink-900)]">
            {tCommon("appName")}
          </span>
        </div>
        <LocaleSwitch locale={locale} />
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-[var(--ink-900)]">
            {title}
          </CardTitle>
          {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>

      {footer ? (
        <div className="mt-5 text-center text-sm text-[var(--ink-500)]">
          {footer}
        </div>
      ) : null}
    </main>
  );
}
