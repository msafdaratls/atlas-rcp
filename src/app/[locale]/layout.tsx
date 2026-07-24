import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import "@/app/globals.css";
import { Toaster } from "@/components/atlas/toaster";
import { ibmPlexMono, montserrat, montserratArabic } from "@/lib/fonts";
import { isLocale, locales, type Locale } from "@/lib/i18n/config";

export const metadata: Metadata = {
  title: {
    default: "Atlas COC",
    template: "%s · Atlas COC",
  },
  description:
    "Atlas Certificate of Conformity portal — أطلس للمساندة والخدمات",
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

type LocaleLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) {
    notFound();
  }
  const locale = raw as Locale;
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      translate="no"
      className={`${montserrat.variable} ${montserratArabic.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
