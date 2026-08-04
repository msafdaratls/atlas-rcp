import { PageHeader } from "@/components/atlas/page-header";
import { Button } from "@/components/ui/button";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { getAtlasSupportContacts } from "@/server/requests/queries";
import { Headphones, Mail, Phone } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function SupportPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const t = await getTranslations("support");
  const tNav = await getTranslations("nav.client");
  const atlas = await getAtlasSupportContacts();
  const email = atlas?.email ?? "support@atls.com.sa";
  const phone = atlas?.phone ?? "+966 11 000 0000";
  const name =
    atlas == null
      ? "Atlas Support & Services"
      : locale === "ar"
        ? atlas.nameAr
        : atlas.nameEn;

  return (
    <div>
      <PageHeader
        title={tNav("support")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("support") }]}
      />

      <div className="grid gap-4">
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-3 flex size-10 items-center justify-center rounded-md border border-line bg-surface-alt text-atlas-green">
            <Headphones className="size-5" />
          </div>
          <h2 className="text-sm font-semibold text-ink-900">{t("contactTitle")}</h2>
          <p className="mt-1 text-sm text-ink-500">{t("contactBody")}</p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-ink-500">{t("org")}</dt>
              <dd className="font-medium text-ink-900">{name}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="size-4 text-atlas-green" aria-hidden />
              <a
                className="font-data text-atlas-green-600"
                href={`mailto:${email}`}
                dir="ltr"
              >
                {email}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="size-4 text-atlas-green" aria-hidden />
              <a
                className="font-data text-ink-900"
                href={`tel:${phone.replace(/\s+/g, "")}`}
                dir="ltr"
              >
                {phone}
              </a>
            </div>
            <div>
              <dt className="text-ink-500">{t("hours")}</dt>
              <dd className="text-ink-900">{t("hoursValue")}</dd>
            </div>
          </dl>
          <Button asChild className="mt-4">
            <a href={`mailto:${email}?subject=${encodeURIComponent(t("mailSubject"))}`}>
              {t("emailCta")}
            </a>
          </Button>
        </section>
      </div>
    </div>
  );
}
