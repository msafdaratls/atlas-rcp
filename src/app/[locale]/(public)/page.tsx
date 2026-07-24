import { notFound, redirect } from "next/navigation";

import { isLocale, type Locale } from "@/lib/i18n/config";

type Props = { params: Promise<{ locale: string }> };

export default async function PublicLandingPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  redirect(`/${locale}/login`);
}
