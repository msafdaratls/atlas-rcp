import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { AuthShell } from "@/components/atlas/auth-shell";
import { ForgotPasswordForm } from "@/components/atlas/forgot-password-form";
import { isLocale, type Locale } from "@/lib/i18n/config";

type Props = { params: Promise<{ locale: string }> };

export default async function ForgotPasswordPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("forgotPassword");

  return (
    <AuthShell locale={locale} title={t("title")} subtitle={t("subtitle")}>
      <ForgotPasswordForm locale={locale} />
    </AuthShell>
  );
}
