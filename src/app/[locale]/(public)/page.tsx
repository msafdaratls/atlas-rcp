import { getTranslations, setRequestLocale } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ locale: string }> };

export default async function PublicLandingPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const tAuth = await getTranslations("auth");
  const tCommon = await getTranslations("common");

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-start justify-center gap-6 px-6">
      <p className="text-sm font-semibold text-atlas-green">{tCommon("appName")}</p>
      <h1 className="text-4xl font-bold text-ink-900">{t("headline")}</h1>
      <p className="max-w-xl text-ink-500">{t("body")}</p>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`/${locale}/login`}>{t("signIn")}</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href={`/${locale}/signup`}>{tAuth("createAccount")}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/${locale}/verify`}>{t("verifyCta")}</Link>
        </Button>
      </div>
    </main>
  );
}
