import { isLocale, type Locale } from "@/lib/i18n/config";
import { formatDate } from "@/lib/format";
import { CheckCircle2, XCircle } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getPublicVerification } from "@/server/requests/public";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ code?: string }>;
};

export default async function VerifyPage({ params, searchParams }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  const { code } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const isAr = locale === "ar";

  const trimmed = code?.trim() ?? "";
  const hasCode = Boolean(trimmed);
  const verification = hasCode
    ? await getPublicVerification(trimmed)
    : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("verifyTitle")}</CardTitle>
          <CardDescription>{t("verifySubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row" action="?">
            <Input
              name="code"
              defaultValue={trimmed}
              placeholder={t("verifyPlaceholder")}
              className="font-mono"
              required
            />
            <Button type="submit">{t("verifySubmit")}</Button>
          </form>

          {!hasCode && (
            <p className="text-sm text-ink-500">{t("verifyEmpty")}</p>
          )}

          {hasCode && !verification && (
            <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
              <XCircle className="mt-0.5 size-5 shrink-0 text-state-bad" />
              <p className="text-sm text-ink-800">{t("verifyNotFound")}</p>
            </div>
          )}

          {verification && (
            <div className="space-y-3 rounded-lg border border-line bg-surface-alt p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" />
                <p className="font-semibold text-ink-900">{t("verifiedTitle")}</p>
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedRequestNo")}</dt>
                  <dd className="text-end font-mono text-ink-900">
                    {verification.requestNo}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedProduct")}</dt>
                  <dd className="text-end font-medium text-ink-900">
                    {isAr
                      ? verification.productNameAr
                      : verification.productNameEn}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedOrg")}</dt>
                  <dd className="text-end font-medium text-ink-900">
                    {isAr
                      ? verification.organisationNameAr
                      : verification.organisationNameEn}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedService")}</dt>
                  <dd className="text-end font-medium text-ink-900">
                    {isAr
                      ? verification.serviceNameAr
                      : verification.serviceNameEn}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedIssuedAt")}</dt>
                  <dd className="text-end font-medium text-ink-900">
                    {formatDate(verification.issuedAt, locale)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
