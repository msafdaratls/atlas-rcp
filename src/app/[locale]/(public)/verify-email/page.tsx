import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";

import { AuthShell } from "@/components/atlas/auth-shell";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { verifyEmailAction } from "@/server/auth/verify-email";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("verifyEmail");

  const { token } = await searchParams;
  const result = token ? await verifyEmailAction(token) : { ok: false as const };
  const ok = result.ok;

  return (
    <AuthShell locale={locale} title={t("title")}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
          {ok ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" />
          ) : (
            <XCircle className="mt-0.5 size-5 shrink-0 text-state-bad" />
          )}
          <div className="space-y-1">
            <p className="font-semibold text-ink-900">
              {ok ? t("successTitle") : t("failTitle")}
            </p>
            <p className="text-sm text-ink-500">
              {ok ? t("successBody") : t("failBody")}
            </p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
      </div>
    </AuthShell>
  );
}
