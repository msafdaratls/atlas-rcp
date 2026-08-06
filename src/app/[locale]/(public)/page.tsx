import { notFound, redirect } from "next/navigation";

import { isLocale, type Locale } from "@/lib/i18n/config";
import { getSession } from "@/lib/auth/session";

type Props = { params: Promise<{ locale: string }> };

export default async function PublicLandingPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;

  const session = await getSession();
  if (session) {
    redirect(
      session.organisation.type === "ATLAS"
        ? `/${locale}/admin`
        : `/${locale}/client/dashboard`,
    );
  }

  redirect(`/${locale}/login`);
}
