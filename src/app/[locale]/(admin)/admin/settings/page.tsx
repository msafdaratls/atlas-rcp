import { AdminSettingsForm } from "@/components/atlas/admin/admin-settings-form";
import { AdminStaffPanel } from "@/components/atlas/admin/admin-staff-panel";
import { TechnicalReviewChecklistEditor } from "@/components/atlas/admin/technical-review-checklist-editor";
import { EmptyState } from "@/components/atlas/empty-state";
import { PageHeader } from "@/components/atlas/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSession } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { requirePagePermission } from "@/lib/page-auth";
import { hasRole } from "@/lib/rbac";
import {
  getAtlasSettings,
  getTechnicalReviewChecklistItems,
  listAtlasStaff,
} from "@/server/admin/queries";
import { Settings } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export default async function AdminSettingsPage({ params }: Props) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw as Locale;
  setRequestLocale(locale);

  const session = await requireSession();
  requirePagePermission(session, "settings:admin", locale);

  const t = await getTranslations("adminOps.settings");
  const tAdmin = await getTranslations("adminOps");
  const tNav = await getTranslations("nav.admin");
  const [settings, staff, technicalReviewChecklistItems] = await Promise.all([
    getAtlasSettings(),
    listAtlasStaff(),
    getTechnicalReviewChecklistItems(),
  ]);

  const canManageStaff =
    session.organisation.type === "ATLAS" && hasRole(session, "SYSTEM_ADMIN");

  return (
    <div>
      <PageHeader
        title={tNav("settings")}
        description={t("pageDescription")}
        breadcrumbs={[{ label: tNav("settings") }]}
      />
      {settings ? (
        <Tabs defaultValue="organisation" className="w-full">
          <TabsList>
            <TabsTrigger value="organisation">
              {t("tabs.organisation")}
            </TabsTrigger>
            <TabsTrigger value="staff">{t("tabs.staff")}</TabsTrigger>
            {canManageStaff ? (
              <TabsTrigger value="technicalReviewChecklist">
                {t("tabs.technicalReviewChecklist")}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value="organisation">
            <AdminSettingsForm data={settings} />
          </TabsContent>
          <TabsContent value="staff">
            {staff ? (
              <AdminStaffPanel
                staff={staff}
                canManage={canManageStaff}
                currentUserId={session.id}
              />
            ) : (
              <EmptyState
                icon={Settings}
                title={tAdmin("unavailableTitle")}
                description={tAdmin("unavailableDescription")}
              />
            )}
          </TabsContent>
          {canManageStaff ? (
            <TabsContent value="technicalReviewChecklist">
              {technicalReviewChecklistItems ? (
                <TechnicalReviewChecklistEditor
                  initial={technicalReviewChecklistItems}
                />
              ) : (
                <EmptyState
                  icon={Settings}
                  title={tAdmin("unavailableTitle")}
                  description={tAdmin("unavailableDescription")}
                />
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      ) : (
        <EmptyState
          icon={Settings}
          title={tAdmin("unavailableTitle")}
          description={tAdmin("unavailableDescription")}
        />
      )}
    </div>
  );
}
