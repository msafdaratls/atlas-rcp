import { AppShell } from "@/components/atlas/app-shell";
import { getSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { storage } from "@/lib/storage";
import { getClientShellRequests } from "@/server/requests/queries";
import {
  getUnreadNotificationCount,
  listNotifications,
} from "@/server/notifications/queries";
import { setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function ClientLayout({ children, params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) {
    redirect(`/${locale}/login`);
  }
  if (session.organisation.type === "ATLAS") {
    redirect(`/${locale}/admin`);
  }

  const organisationLogoUrl = session.organisation.logoKey
    ? storage.publicUrl(session.organisation.logoKey)
    : undefined;

  const user = {
    name: locale === "ar" ? session.fullNameAr : session.fullNameEn,
    email: session.email,
    organisationName:
      locale === "ar" ? session.organisation.nameAr : session.organisation.nameEn,
    organisationLogoUrl,
  };

  const [unreadCount, notifications, requests] = await Promise.all([
    getUnreadNotificationCount(),
    listNotifications(20),
    getClientShellRequests(locale),
  ]);

  return (
    <AppShell
      mode="client"
      locale={locale}
      user={user}
      roles={session.roles}
      unreadCount={unreadCount}
      notifications={notifications}
      requests={requests}
    >
      {children}
    </AppShell>
  );
}
