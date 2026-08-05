"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  completeEvaluationActivity,
  scheduleEvaluationActivity,
  uploadActivityReport,
} from "@/server/admin/actions";
import type { AdminRequestDetailItem, AssignableStaffUser } from "@/server/admin/queries";
import type { EvaluationActivityStatus, EvaluationActivityType } from "@prisma/client";
import { CheckCircle2, FileText, Loader2, Paperclip, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Activity = AdminRequestDetailItem["activities"][number];

type Props = {
  requestItemId: string;
  title?: string;
  serviceItem: {
    requiresInspection: boolean;
    requiresLabTesting: boolean;
    requiresFactoryAudit: boolean;
  };
  activities: Activity[];
  assignableStaff: AssignableStaffUser[];
  editable: boolean;
  locale: string;
};

const APPLICABLE_TYPES: Array<{
  type: EvaluationActivityType;
  flag: keyof Props["serviceItem"];
}> = [
  { type: "SHIPMENT_INSPECTION", flag: "requiresInspection" },
  { type: "LABORATORY_TESTING", flag: "requiresLabTesting" },
  { type: "FACTORY_AUDIT", flag: "requiresFactoryAudit" },
];

const STATUS_TONE: Record<EvaluationActivityStatus, string> = {
  SCHEDULED: "bg-surface-alt text-ink-600 border-line",
  IN_PROGRESS: "bg-state-warn/12 text-state-warn border-state-warn/30",
  COMPLETED: "bg-state-ok/12 text-state-ok border-state-ok/30",
};

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function EvaluationActivitiesPanel({
  requestItemId,
  title: panelTitle,
  serviceItem,
  activities,
  assignableStaff,
  editable,
  locale,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.activities");
  const isAr = locale === "ar";

  const applicable = APPLICABLE_TYPES.filter((a) => serviceItem[a.flag]);
  if (applicable.length === 0) return null;

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {panelTitle ? `${t("title")} — ${panelTitle}` : t("title")}
        </h2>
        <p className="text-xs text-ink-500">{t("subtitle")}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {applicable.map(({ type }) => (
          <ActivityCard
            key={type}
            requestItemId={requestItemId}
            type={type}
            activity={activities.find((a) => a.type === type) ?? null}
            assignableStaff={assignableStaff}
            editable={editable}
            isAr={isAr}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityCard({
  requestItemId,
  type,
  activity,
  assignableStaff,
  editable,
  isAr,
  t,
}: {
  requestItemId: string;
  type: EvaluationActivityType;
  activity: Activity | null;
  assignableStaff: AssignableStaffUser[];
  editable: boolean;
  isAr: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [scheduledDate, setScheduledDate] = useState(
    activity?.scheduledDate?.slice(0, 10) ?? "",
  );
  const [assignedUserId, setAssignedUserId] = useState(
    activity?.assignedUserId ?? "",
  );
  const [qualificationNote, setQualificationNote] = useState(
    activity?.qualificationNote ?? "",
  );
  const [schedulePending, startScheduleTransition] = useTransition();
  const [uploadPending, startUploadTransition] = useTransition();
  const [completePending, startCompleteTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);

  const status: EvaluationActivityStatus = activity?.status ?? "SCHEDULED";
  const isUnderInspection = type === "SHIPMENT_INSPECTION" && status === "IN_PROGRESS";
  const isUnderAudit = type === "FACTORY_AUDIT" && status === "IN_PROGRESS";

  function submitSchedule() {
    startScheduleTransition(async () => {
      const result = await scheduleEvaluationActivity({
        requestItemId,
        type,
        scheduledDate: scheduledDate || undefined,
        assignedUserId: assignedUserId || undefined,
        qualificationNote: qualificationNote.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("scheduled"));
    });
  }

  function submitUpload() {
    if (!file || !activity) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.set("activityId", activity.id);
      formData.set("file", file);
      const result = await uploadActivityReport(formData);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("reportUploaded"));
      setFile(null);
    });
  }

  function submitComplete() {
    if (!activity) return;
    startCompleteTransition(async () => {
      const result = await completeEvaluationActivity({ activityId: activity.id });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("completed"));
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">{t(`type.${type}`)}</h3>
        <div className="flex items-center gap-1.5">
          {isUnderInspection ? (
            <span className="rounded-full border border-state-warn/30 bg-state-warn/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-state-warn">
              {t("underInspection")}
            </span>
          ) : null}
          {isUnderAudit ? (
            <span className="rounded-full border border-state-warn/30 bg-state-warn/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-state-warn">
              {t("underAudit")}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              STATUS_TONE[status],
            )}
          >
            {t(`status.${status}`)}
          </span>
        </div>
      </div>

      {editable && status !== "COMPLETED" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">
              {type === "FACTORY_AUDIT" ? t("auditDate") : t("inspectionDate")}
            </Label>
            <Input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              dir="ltr"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              {type === "FACTORY_AUDIT" ? t("auditorSelect") : t("inspectorSelect")}
            </Label>
            <Select value={assignedUserId} onValueChange={setAssignedUserId}>
              <SelectTrigger>
                <SelectValue placeholder={t("selectStaff")} />
              </SelectTrigger>
              <SelectContent>
                {assignableStaff.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {isAr ? u.fullNameAr : u.fullNameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">
              {type === "FACTORY_AUDIT" ? t("auditorQualification") : t("inspectorQualification")}
            </Label>
            <Textarea
              value={qualificationNote}
              onChange={(e) => setQualificationNote(e.target.value)}
              rows={2}
            />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={schedulePending}
              onClick={submitSchedule}
            >
              {schedulePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {t("saveSchedule")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs">{t("reports")}</Label>
        {!activity || activity.reports.length === 0 ? (
          <p className="text-xs text-ink-500">{t("noReports")}</p>
        ) : (
          <ul className="space-y-1">
            {activity.reports.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs text-atlas-green hover:underline"
                  onClick={() =>
                    window.open(storageUrl(r.storageKey), "_blank", "noopener,noreferrer")
                  }
                >
                  <FileText className="size-3.5" />
                  {r.fileName}
                </button>
              </li>
            ))}
          </ul>
        )}
        {editable && activity && status !== "COMPLETED" ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="h-9 max-w-56 text-xs"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={uploadPending || !file}
              onClick={submitUpload}
            >
              {uploadPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
              {t("uploadReport")}
            </Button>
          </div>
        ) : null}
        {!activity && editable ? (
          <p className="text-xs text-ink-400">{t("scheduleFirst")}</p>
        ) : null}
      </div>

      {editable && activity && status === "IN_PROGRESS" ? (
        <Button
          type="button"
          size="sm"
          disabled={completePending || activity.reports.length === 0}
          onClick={submitComplete}
        >
          {completePending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          {t("complete")}
        </Button>
      ) : null}
    </div>
  );
}
