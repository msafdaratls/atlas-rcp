import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { XCircle } from "lucide-react";

import { AuthShell } from "@/components/atlas/auth-shell";
import { ResetPasswordForm } from "@/components/atlas/reset-password-form";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/i18n/navigation";
import { isLocale, type Locale } from "@/lib/i18n/config";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("resetPassword");

  const { token } = await searchParams;

  return (
    <AuthShell locale={locale} title={t("title")} subtitle={t("subtitle")}>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
            <XCircle className="mt-0.5 size-5 shrink-0 text-state-bad" />
            <p className="text-sm text-ink-800">{t("missingToken")}</p>
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/forgot-password">{t("requestNew")}</Link>
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
