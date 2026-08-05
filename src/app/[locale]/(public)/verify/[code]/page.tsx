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
  params: Promise<{ locale: string; code: string }>;
};

export default async function VerifyCodePage({ params }: Props) {
  const { locale: raw, code } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("landing");
  const isAr = locale === "ar";

  const verification = await getPublicVerification(code);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-6 py-16">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("verifyTitle")}</CardTitle>
          <CardDescription>{t("verifySubtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="font-data text-sm text-ink-800" dir="ltr">
            {code}
          </p>
          {verification ? (
            <div className="space-y-3 rounded-lg border border-line bg-surface-alt p-4">
              <div className="flex items-center gap-2 text-state-ok">
                <CheckCircle2 className="size-5 shrink-0" aria-hidden />
                <span className="text-sm font-semibold">
                  {t("verifiedTitle")}
                </span>
              </div>
              <dl className="grid grid-cols-1 gap-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedRequestNo")}</dt>
                  <dd className="font-data text-ink-900" dir="ltr">
                    {verification.requestNo}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedProduct")}</dt>
                  <dd className="text-start text-ink-900">
                    {verification.items
                      .map((i) => (isAr ? i.productNameAr : i.productNameEn))
                      .join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedOrg")}</dt>
                  <dd className="text-start text-ink-900">
                    {isAr
                      ? verification.organisationNameAr
                      : verification.organisationNameEn}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedService")}</dt>
                  <dd className="text-start text-ink-900">
                    {verification.items
                      .map((i) => (isAr ? i.serviceNameAr : i.serviceNameEn))
                      .join(", ")}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-500">{t("verifiedIssuedAt")}</dt>
                  <dd className="font-data text-ink-900">
                    {formatDate(verification.issuedAt, locale)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-state-bad">
              <XCircle className="size-5 shrink-0" aria-hidden />
              <p className="text-sm">{t("verifyNotFound")}</p>
            </div>
          )}
          <form className="flex flex-col gap-3 sm:flex-row" action="../">
            <Input
              name="code"
              defaultValue={code}
              placeholder={t("verifyPlaceholder")}
              className="font-data"
            />
            <Button type="submit">{t("verifySubmit")}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
