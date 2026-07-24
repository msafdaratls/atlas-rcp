import { NotificationCentre } from "@/components/atlas/notification-centre";
import { PageHeader } from "@/components/atlas/page-header";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { listNotifications } from "@/server/notifications/queries";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function ClientNotificationsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const t = await getTranslations("notifications");
  const items = await listNotifications(100);

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: t("title") }]}
      />
      <NotificationCentre items={items} />
    </div>
  );
}
