"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  markExternalDeliverableIssued,
  rejectExternalDeliverable,
  submitExternalDeliverable,
  uploadExternalDeliverableFile,
} from "@/server/admin/actions";
import type { AdminRequestDetailItem } from "@/server/admin/queries";
import { CheckCircle2, FileText, Loader2, Paperclip, Send, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Deliverable = NonNullable<AdminRequestDetailItem["externalDeliverable"]>;

type Props = {
  requestItemId: string;
  title?: string;
  serviceItem: { deliverableType: "INTERNAL_REPORT" | "EXTERNAL_CERTIFICATE" };
  deliverable: Deliverable | null;
  editable: boolean;
  locale: string;
  /**
   * True once the request has reached REPORT_ISSUED or later: the Evaluator
   * must attach the real certificate obtained from SABER/SFDA before closing,
   * regardless of whether the service is normally EXTERNAL_CERTIFICATE-typed.
   */
  certificateRequired: boolean;
};

const STATUS_TONE: Record<Deliverable["status"], string> = {
  PENDING_SUBMISSION: "bg-surface-alt text-ink-600 border-line",
  SUBMITTED: "bg-state-warn/12 text-state-warn border-state-warn/30",
  ISSUED: "bg-state-ok/12 text-state-ok border-state-ok/30",
  REJECTED: "bg-state-error/12 text-state-error border-state-error/30",
};

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function ExternalDeliverablePanel({
  requestItemId,
  title: panelTitle,
  serviceItem,
  deliverable,
  editable,
  certificateRequired,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.externalDeliverable");

  const status = deliverable?.status ?? "PENDING_SUBMISSION";

  const [externalRefType, setExternalRefType] = useState(
    deliverable?.externalRefType ?? "",
  );
  const [externalRefValue, setExternalRefValue] = useState(
    deliverable?.externalRefValue ?? "",
  );
  const [notes, setNotes] = useState(deliverable?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [submitPending, startSubmitTransition] = useTransition();
  const [uploadPending, startUploadTransition] = useTransition();
  const [issuePending, startIssueTransition] = useTransition();
  const [rejectPending, startRejectTransition] = useTransition();

  if (serviceItem.deliverableType !== "EXTERNAL_CERTIFICATE" && !certificateRequired) {
    return null;
  }

  function doSubmit() {
    if (!externalRefType.trim()) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    startSubmitTransition(async () => {
      const result = await submitExternalDeliverable({
        requestItemId,
        externalRefType: externalRefType.trim(),
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("submitted"));
    });
  }

  function doUpload() {
    if (!file || !deliverable) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.set("deliverableId", deliverable.id);
      formData.set("file", file);
      const result = await uploadExternalDeliverableFile(formData);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("fileUploaded"));
      setFile(null);
    });
  }

  function doIssue() {
    if (!deliverable || !externalRefValue.trim()) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    startIssueTransition(async () => {
      const result = await markExternalDeliverableIssued({
        deliverableId: deliverable.id,
        externalRefValue: externalRefValue.trim(),
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("issued"));
    });
  }

  function doReject() {
    if (!deliverable) return;
    startRejectTransition(async () => {
      const result = await rejectExternalDeliverable({
        deliverableId: deliverable.id,
        notes: notes.trim() || t("rejectedDefaultNote"),
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("rejected"));
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {panelTitle ? `${t("title")} — ${panelTitle}` : t("title")}
          </h2>
          <p className="text-xs text-ink-500">{t("subtitle")}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            STATUS_TONE[status],
          )}
        >
          {t(`status.${status}`)}
        </span>
      </div>

      {editable && status !== "ISSUED" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">{t("refType")}</Label>
            <Input
              value={externalRefType}
              onChange={(e) => setExternalRefType(e.target.value)}
              placeholder={t("refTypePlaceholder")}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs">{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="sm:col-span-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={submitPending}
              onClick={doSubmit}
            >
              {submitPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {deliverable ? t("resubmit") : t("submit")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs">{t("files")}</Label>
        {!deliverable || deliverable.files.length === 0 ? (
          <p className="text-xs text-ink-500">{t("noFiles")}</p>
        ) : (
          <ul className="space-y-1">
            {deliverable.files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs text-atlas-green hover:underline"
                  onClick={() =>
                    window.open(storageUrl(f.storageKey), "_blank", "noopener,noreferrer")
                  }
                >
                  <FileText className="size-3.5" />
                  {f.fileName}
                </button>
              </li>
            ))}
          </ul>
        )}
        {editable && deliverable && status !== "ISSUED" ? (
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
              onClick={doUpload}
            >
              {uploadPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
              {t("uploadFile")}
            </Button>
          </div>
        ) : null}
        {!deliverable && editable ? (
          <p className="text-xs text-ink-400">{t("submitFirst")}</p>
        ) : null}
      </div>

      {editable && deliverable && status === "SUBMITTED" ? (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("refValue")}</Label>
            <Input
              value={externalRefValue}
              onChange={(e) => setExternalRefValue(e.target.value)}
              placeholder={t("refValuePlaceholder")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={issuePending || deliverable.files.length === 0}
              onClick={doIssue}
            >
              {issuePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {t("markIssued")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={rejectPending}
              onClick={doReject}
            >
              {rejectPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {t("markRejected")}
            </Button>
          </div>
        </div>
      ) : null}

      {status === "ISSUED" && deliverable?.externalRefValue ? (
        <p className="text-xs font-medium text-state-ok">
          {t("issuedRef", { value: deliverable.externalRefValue })}
        </p>
      ) : null}
    </section>
  );
}
