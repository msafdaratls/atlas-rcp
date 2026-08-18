"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { uploadEvaluationReport } from "@/server/admin/actions";
import type { AdminRequestDetailItem } from "@/server/admin/queries";
import { CheckCircle2, FileText, Loader2, Paperclip, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Document = AdminRequestDetailItem["documents"][number];

const DEFAULT_EVALUATION_REPORT_LABEL = "Evaluation Report";

/**
 * Most services need one generic "Evaluation Report" upload before Complete
 * Evaluation. Cosmetic SCOC (SFDA-COS-002) needs 3 specifically-named
 * documents instead. Kept in sync with the identical map in
 * `src/server/admin/actions.ts` (`EVALUATION_REPORT_LABELS`), which is the
 * source of truth enforced server-side — this copy only drives what the
 * panel renders.
 */
const EVALUATION_REPORT_LABELS: Record<string, string[]> = {
  "SFDA-COS-002": ["Evaluation Check List", "Inspection Report", "Test Report"],
};

function evaluationReportLabelsFor(serviceCode: string): string[] {
  return EVALUATION_REPORT_LABELS[serviceCode] ?? [DEFAULT_EVALUATION_REPORT_LABEL];
}

type Props = {
  requestItemId: string;
  serviceCode: string;
  title?: string;
  documents: Document[];
  editable: boolean;
};

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

type UploadProps = {
  requestItemId: string;
  label: string;
  document: Document | null;
  editable: boolean;
};

/** The file-link + upload/replace control for a single required document label. */
function EvaluationReportUpload({ requestItemId, label, document, editable }: UploadProps) {
  const t = useTranslations("adminOps.requestDetail.evaluationReport");
  const tErrors = useTranslations("adminOps.requestDetail.errors");
  const [file, setFile] = useState<File | null>(null);
  const [uploadPending, startUploadTransition] = useTransition();

  function doUpload() {
    if (!file) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.set("requestItemId", requestItemId);
      formData.set("label", label);
      formData.set("file", file);
      const result = await uploadEvaluationReport(formData);
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("uploaded"));
      setFile(null);
    });
  }

  return (
    <>
      {document?.currentVersion ? (
        <a
          href={storageUrl(document.currentVersion.storageKey)}
          target="_blank"
          rel="noreferrer"
          className="mb-3 flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <FileText className="size-4" />
          {document.currentVersion.fileName}
        </a>
      ) : null}

      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink-600">
            <Paperclip className="size-4" />
            <Input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              className="max-w-64"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!file || uploadPending}
            onClick={doUpload}
          >
            {uploadPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {document ? t("replace") : t("upload")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function statusBadge(uploaded: boolean, t: ReturnType<typeof useTranslations>) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-xs font-medium",
        uploaded
          ? "border-state-ok/30 bg-state-ok/12 text-state-ok"
          : "border-line bg-surface-alt text-ink-600",
      )}
    >
      {uploaded ? (
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 className="size-3.5" />
          {t("uploaded")}
        </span>
      ) : (
        t("missing")
      )}
    </span>
  );
}

/**
 * Doc's "Upload Evaluation Report" step before Complete Evaluation. Enforced
 * server-side (`EVALUATION_REPORT_REQUIRED` gate on ASSESSMENT_RUNNING ->
 * TECHNICAL_REVIEW/DECISION) — this panel is where the Evaluator satisfies
 * it. Renders one upload control per required document label for the item's
 * service (see EVALUATION_REPORT_LABELS above): a single plain slot for most
 * services (identical to the original single-document layout), or several
 * individually-labeled slots for services like Cosmetic SCOC that need more
 * than one specific document.
 */
export function EvaluationReportPanel({
  requestItemId,
  serviceCode,
  title: panelTitle,
  documents,
  editable,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.evaluationReport");

  const labels = evaluationReportLabelsFor(serviceCode);
  const documentFor = (label: string) => documents.find((d) => d.label === label) ?? null;
  const allUploaded = labels.every((label) => documentFor(label)?.currentVersion);

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">
          {t("title")}
          {panelTitle ? <span className="text-ink-500"> · {panelTitle}</span> : null}
        </h3>
        {statusBadge(allUploaded, t)}
      </div>

      {labels.length === 1 ? (
        <EvaluationReportUpload
          requestItemId={requestItemId}
          label={labels[0]}
          document={documentFor(labels[0])}
          editable={editable}
        />
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink-600">{t("shouldUpload")}</p>
          {labels.map((label) => {
            const document = documentFor(label);
            return (
              <div
                key={label}
                className="space-y-2 rounded-lg border border-line/70 bg-surface-alt/40 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-800">{label}</span>
                  {statusBadge(Boolean(document?.currentVersion), t)}
                </div>
                <EvaluationReportUpload
                  requestItemId={requestItemId}
                  label={label}
                  document={document}
                  editable={editable}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
