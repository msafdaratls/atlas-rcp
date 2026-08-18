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
  addRequiredTest,
  completeEvaluationActivity,
  confirmSampleReceived,
  recordSampleShipment,
  removeRequiredTest,
  scheduleEvaluationActivity,
  selectLaboratory,
  uploadActivityReport,
} from "@/server/admin/actions";
import type { AdminRequestDetailItem, AssignableStaffUser } from "@/server/admin/queries";
import type { EvaluationActivityStatus, EvaluationActivityType } from "@prisma/client";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Send,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Activity = AdminRequestDetailItem["activities"][number];
type RequiredTest = AdminRequestDetailItem["requiredTests"][number];
type PickerOption = { id: string; nameEn: string; nameAr: string };

type Props = {
  requestItemId: string;
  title?: string;
  serviceItem: {
    requiresInspection: boolean;
    requiresLabTesting: boolean;
    requiresFactoryAudit: boolean;
  };
  activities: Activity[];
  requiredTests: RequiredTest[];
  laboratories: PickerOption[];
  testTypes: PickerOption[];
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
  requiredTests,
  laboratories,
  testTypes,
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
            requiredTests={requiredTests}
            laboratories={laboratories}
            testTypes={testTypes}
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
  requiredTests,
  laboratories,
  testTypes,
  assignableStaff,
  editable,
  isAr,
  t,
}: {
  requestItemId: string;
  type: EvaluationActivityType;
  activity: Activity | null;
  requiredTests: RequiredTest[];
  laboratories: PickerOption[];
  testTypes: PickerOption[];
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
  const isUnderTesting = type === "LABORATORY_TESTING" && status === "IN_PROGRESS";

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
          {isUnderTesting ? (
            <span className="rounded-full border border-state-warn/30 bg-state-warn/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-state-warn">
              {t("underTesting")}
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

      {type === "LABORATORY_TESTING" ? (
        <div className="space-y-3 border-b border-line pb-3">
          <RequiredTestsSection
            requestItemId={requestItemId}
            requiredTests={requiredTests}
            testTypes={testTypes}
            editable={editable && status !== "COMPLETED"}
            isAr={isAr}
            t={t}
          />
          <LaboratorySection
            requestItemId={requestItemId}
            activity={activity}
            laboratories={laboratories}
            editable={editable && status !== "COMPLETED"}
            isAr={isAr}
            t={t}
          />
          <SampleShipmentSection
            activity={activity}
            editable={editable && status !== "COMPLETED"}
            t={t}
          />
        </div>
      ) : null}

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

function RequiredTestsSection({
  requestItemId,
  requiredTests,
  testTypes,
  editable,
  isAr,
  t,
}: {
  requestItemId: string;
  requiredTests: RequiredTest[];
  testTypes: PickerOption[];
  editable: boolean;
  isAr: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [testTypeId, setTestTypeId] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [pending, startTransition] = useTransition();

  function submitAdd() {
    if (!testTypeId && !customLabel.trim()) return;
    startTransition(async () => {
      const result = await addRequiredTest({
        requestItemId,
        testTypeId: testTypeId || undefined,
        customLabel: testTypeId ? undefined : customLabel.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setTestTypeId("");
      setCustomLabel("");
    });
  }

  function submitRemove(id: string) {
    startTransition(async () => {
      const result = await removeRequiredTest({ id });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("requiredTests")}</Label>
      {requiredTests.length === 0 ? (
        <p className="text-xs text-ink-500">{t("noRequiredTests")}</p>
      ) : (
        <ul className="space-y-1">
          {requiredTests.map((rt) => (
            <li
              key={rt.id}
              className="flex items-center justify-between gap-2 rounded border border-line bg-surface-alt px-2 py-1 text-xs"
            >
              <span>
                {rt.testTypeId
                  ? isAr
                    ? rt.testTypeNameAr
                    : rt.testTypeNameEn
                  : rt.customLabel}
              </span>
              {editable ? (
                <button
                  type="button"
                  className="text-ink-400 hover:text-state-bad"
                  disabled={pending}
                  onClick={() => submitRemove(rt.id)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={testTypeId}
            onValueChange={(v) => {
              setTestTypeId(v);
              setCustomLabel("");
            }}
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder={t("selectTestType")} />
            </SelectTrigger>
            <SelectContent>
              {testTypes.map((tt) => (
                <SelectItem key={tt.id} value={tt.id}>
                  {isAr ? tt.nameAr : tt.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-ink-400">{t("or")}</span>
          <Input
            className="h-8 max-w-48 text-xs"
            placeholder={t("customTestLabel")}
            value={customLabel}
            onChange={(e) => {
              setCustomLabel(e.target.value);
              setTestTypeId("");
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || (!testTypeId && !customLabel.trim())}
            onClick={submitAdd}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {t("addTest")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function LaboratorySection({
  requestItemId,
  activity,
  laboratories,
  editable,
  isAr,
  t,
}: {
  requestItemId: string;
  activity: Activity | null;
  laboratories: PickerOption[];
  editable: boolean;
  isAr: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [laboratoryId, setLaboratoryId] = useState(activity?.laboratoryId ?? "");
  const [pending, startTransition] = useTransition();

  function submitSelect() {
    if (!laboratoryId) return;
    startTransition(async () => {
      const result = await selectLaboratory({ requestItemId, laboratoryId });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("laboratorySelected"));
    });
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("laboratory")}</Label>
      {activity?.laboratoryId ? (
        <p className="text-xs text-ink-700">
          {isAr ? activity.laboratoryNameAr : activity.laboratoryNameEn}
        </p>
      ) : null}
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={laboratoryId} onValueChange={setLaboratoryId}>
            <SelectTrigger className="h-8 w-56 text-xs">
              <SelectValue placeholder={t("selectLaboratory")} />
            </SelectTrigger>
            <SelectContent>
              {laboratories.map((lab) => (
                <SelectItem key={lab.id} value={lab.id}>
                  {isAr ? lab.nameAr : lab.nameEn}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              pending || !laboratoryId || laboratoryId === activity?.laboratoryId
            }
            onClick={submitSelect}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {t("saveLaboratory")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SampleShipmentSection({
  activity,
  editable,
  t,
}: {
  activity: Activity | null;
  editable: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [trackingNumber, setTrackingNumber] = useState(
    activity?.sampleTrackingNo ?? "",
  );
  const [carrier, setCarrier] = useState(activity?.sampleCarrier ?? "");
  const [sentAt, setSentAt] = useState(activity?.sampleSentAt?.slice(0, 10) ?? "");
  const [receivedAt, setReceivedAt] = useState(
    activity?.sampleReceivedAt?.slice(0, 10) ?? "",
  );
  const [sendPending, startSendTransition] = useTransition();
  const [receivePending, startReceiveTransition] = useTransition();

  if (!activity?.laboratoryId) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">{t("sampleShipment")}</Label>
        <p className="text-xs text-ink-400">{t("selectLaboratoryFirst")}</p>
      </div>
    );
  }

  function submitSend() {
    if (!sentAt || !activity) return;
    startSendTransition(async () => {
      const result = await recordSampleShipment({
        activityId: activity.id,
        trackingNumber: trackingNumber.trim() || undefined,
        carrier: carrier.trim() || undefined,
        sentAt,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("sampleShipmentRecorded"));
    });
  }

  function submitReceive() {
    if (!receivedAt || !activity) return;
    startReceiveTransition(async () => {
      const result = await confirmSampleReceived({
        activityId: activity.id,
        receivedAt,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("sampleReceivedConfirmed"));
    });
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">{t("sampleShipment")}</Label>
      {editable && !activity.sampleSentAt ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            className="h-8 text-xs"
            placeholder={t("trackingNumber")}
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
          <Input
            className="h-8 text-xs"
            placeholder={t("carrier")}
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
          />
          <Input
            type="date"
            className="h-8 text-xs"
            dir="ltr"
            value={sentAt}
            onChange={(e) => setSentAt(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={sendPending || !sentAt}
            onClick={submitSend}
          >
            {sendPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {t("markSent")}
          </Button>
        </div>
      ) : null}
      {activity.sampleSentAt ? (
        <p className="text-xs text-ink-600">
          {t("sentOn", { date: activity.sampleSentAt.slice(0, 10) })}
          {activity.sampleTrackingNo ? ` · ${activity.sampleTrackingNo}` : ""}
          {activity.sampleCarrier ? ` · ${activity.sampleCarrier}` : ""}
        </p>
      ) : null}
      {editable && activity.sampleSentAt && !activity.sampleReceivedAt ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            className="h-8 text-xs"
            dir="ltr"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={receivePending || !receivedAt}
            onClick={submitReceive}
          >
            {receivePending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {t("confirmReceived")}
          </Button>
        </div>
      ) : null}
      {activity.sampleReceivedAt ? (
        <p className="text-xs text-ink-600">
          {t("receivedOn", { date: activity.sampleReceivedAt.slice(0, 10) })}
        </p>
      ) : null}
    </div>
  );
}
