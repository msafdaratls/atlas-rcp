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

const EVALUATION_REPORT_LABEL = "Evaluation Report";

type Props = {
  requestItemId: string;
  title?: string;
  documents: Document[];
  editable: boolean;
};

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Doc's "Upload Evaluation Report" step before Complete Evaluation. Enforced
 * server-side (`EVALUATION_REPORT_REQUIRED` gate on ASSESSMENT_RUNNING ->
 * TECHNICAL_REVIEW) — this panel is where the Evaluator satisfies it.
 */
export function EvaluationReportPanel({
  requestItemId,
  title: panelTitle,
  documents,
  editable,
}: Props) {
  const t = useTranslations("adminOps.requestDetail.evaluationReport");
  const tErrors = useTranslations("adminOps.requestDetail.errors");

  const report = documents.find((d) => d.label === EVALUATION_REPORT_LABEL) ?? null;
  const [file, setFile] = useState<File | null>(null);
  const [uploadPending, startUploadTransition] = useTransition();

  function doUpload() {
    if (!file) return;
    startUploadTransition(async () => {
      const formData = new FormData();
      formData.set("requestItemId", requestItemId);
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
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900">
          {t("title")}
          {panelTitle ? <span className="text-ink-500"> · {panelTitle}</span> : null}
        </h3>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-xs font-medium",
            report
              ? "border-state-ok/30 bg-state-ok/12 text-state-ok"
              : "border-line bg-surface-alt text-ink-600",
          )}
        >
          {report ? (
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="size-3.5" />
              {t("uploaded")}
            </span>
          ) : (
            t("missing")
          )}
        </span>
      </div>

      {report?.currentVersion ? (
        <a
          href={storageUrl(report.currentVersion.storageKey)}
          target="_blank"
          rel="noreferrer"
          className="mb-3 flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <FileText className="size-4" />
          {report.currentVersion.fileName}
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
            {report ? t("replace") : t("upload")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
