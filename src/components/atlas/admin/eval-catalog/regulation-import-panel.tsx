"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChecklistDiff, RegulationDiff } from "@/lib/eval-catalog/diff";
import type { ImportIssue } from "@/lib/eval-catalog/parse";
import { TARIFF_EVAL_SERVICE_CODES } from "@/lib/tariff-evaluation-services";
import { cn } from "@/lib/utils";
import {
  applyRegulationImport,
  discardRegulationImport,
  downloadRegulationTemplate,
  exportRegulationWorkbook,
  uploadRegulationWorkbook,
  type RegulationImportPreview,
} from "@/server/admin/eval-catalog-import-actions";
import { AlertTriangle, CheckCircle2, ChevronRight, Download, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type RegulationOption = { id: string; code: string; titleEn: string; titleAr: string; serviceCode: string };

type ImportHistoryRow = {
  id: string;
  regulationCode: string;
  sourceFilename: string;
  status: "PENDING" | "APPLIED" | "DISCARDED";
  uploadedAt: string;
  uploadedBy: string;
  appliedAt: string | null;
};

type Props = {
  regulations: RegulationOption[];
  history: ImportHistoryRow[];
};

/** Turns an action's base64 payload into a browser download without a round trip through storage. */
function downloadBase64(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type Translator = ReturnType<typeof useTranslations<"adminOps.evalCatalog.import">>;

/**
 * Parser issues arrive as a code plus parameters so they can be worded in the
 * reader's own language. An unrecognised code still has to render something
 * useful rather than throwing, so it falls back to the raw code — a workbook
 * from a newer build must not blank out the error list.
 */
function IssueLine({
  issue,
  className,
  t,
}: {
  issue: ImportIssue;
  className: string;
  t: Translator;
}) {
  const key = `issues.${issue.code}` as "issues.NOT_XLSX";
  const text = t.has(key) ? t(key, issue.params) : issue.code;
  const where = [issue.sheet, issue.row ? `${t("row")} ${issue.row}` : null, issue.column]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className={className}>
      {where ? `${where}: ` : null}
      {text}
    </li>
  );
}

function CountBadge({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", tone)}>
      {label}: {value}
    </span>
  );
}

function ChecklistDiffRow({ label, diff, t }: { label: string; diff: ChecklistDiff; t: ReturnType<typeof useTranslations> }) {
  if (!diff.present) {
    return (
      <li className="text-xs text-ink-500">
        {label} — {t("diff.sheetAbsent")}
      </li>
    );
  }
  const touched = diff.added.length + diff.removed.length + diff.retitled.length;
  return (
    <li className="text-xs text-ink-700">
      <span className="font-medium">{label}</span> — {t("diff.replacing", { before: diff.before, after: diff.after })}
      {touched === 0 ? ` · ${t("diff.noChange")}` : null}
      {diff.added.length > 0 ? ` · ${t("diff.added")}: ${diff.added.join(", ")}` : null}
      {diff.removed.length > 0 ? (
        <span className="text-state-bad"> · {t("diff.removed")}: {diff.removed.join(", ")}</span>
      ) : null}
      {diff.retitled.length > 0 ? ` · ${t("diff.retitled")}: ${diff.retitled.join(", ")}` : null}
    </li>
  );
}

/**
 * Upload → review the diff → apply. Nothing reaches the catalog until the
 * operator has seen exactly what would change, and the apply is additive:
 * rows a sheet omits are reported but never deleted.
 */
export function RegulationImportPanel({ regulations, history }: Props) {
  const t = useTranslations("adminOps.evalCatalog.import");
  const tErrors = useTranslations("adminOps.evalCatalog.import.errors");
  const locale = useLocale();
  const isAr = locale === "ar";

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RegulationImportPreview | null>(null);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [exportId, setExportId] = useState("");
  const [templateService, setTemplateService] = useState<string>(TARIFF_EVAL_SERVICE_CODES[0]);
  const [pending, startTransition] = useTransition();

  function upload() {
    if (!file) return;
    setIssues([]);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadRegulationWorkbook(formData);
      if (!result.ok) {
        setPreview(null);
        setIssues(result.issues ?? []);
        toast.error(tErrors(result.error as "UPLOAD_FAILED"));
        return;
      }
      setPreview(result.data);
      toast.success(result.data.noChanges ? t("previewNoChanges") : t("previewReady"));
    });
  }

  function apply() {
    if (!preview) return;
    startTransition(async () => {
      const result = await applyRegulationImport({ importId: preview.importId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "APPLY_FAILED"));
        return;
      }
      setPreview(null);
      setFile(null);
      toast.success(t("applied"));
    });
  }

  function discard() {
    if (!preview) return;
    startTransition(async () => {
      const result = await discardRegulationImport({ importId: preview.importId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "SAVE_FAILED"));
        return;
      }
      setPreview(null);
      setFile(null);
      toast.success(t("discarded"));
    });
  }

  function downloadTemplate() {
    startTransition(async () => {
      const result = await downloadRegulationTemplate({
        serviceCode: templateService as (typeof TARIFF_EVAL_SERVICE_CODES)[number],
      });
      if (!result.ok) {
        toast.error(tErrors(result.error as "EXPORT_FAILED"));
        return;
      }
      downloadBase64(result.data.fileName, result.data.base64);
    });
  }

  function exportRegulation() {
    if (!exportId) return;
    startTransition(async () => {
      const result = await exportRegulationWorkbook({ technicalRegulationId: exportId });
      if (!result.ok) {
        toast.error(tErrors(result.error as "EXPORT_FAILED"));
        return;
      }
      downloadBase64(result.data.fileName, result.data.base64);
    });
  }

  const diff: RegulationDiff | null = preview?.diff ?? null;
  const knownRegulationCodes = new Set(regulations.map((r) => r.code));

  return (
    <div className="space-y-4">
      {/* Get a workbook to edit */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{t("startTitle")}</h3>
          <p className="text-xs text-ink-500">{t("startSubtitle")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-600">{t("exportExisting")}</label>
            <div className="flex gap-2">
              <Select value={exportId} onValueChange={setExportId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("exportPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {regulations.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {isAr ? r.titleAr : r.titleEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" disabled={!exportId || pending} onClick={exportRegulation}>
                <Download className="size-4" />
                {t("export")}
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-600">{t("blankTemplate")}</label>
            <div className="flex gap-2">
              <Select value={templateService} onValueChange={setTemplateService}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARIFF_EVAL_SERVICE_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`service.${code}` as "service.SAB-001")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" disabled={pending} onClick={downloadTemplate}>
                <FileSpreadsheet className="size-4" />
                {t("template")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Upload */}
      <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{t("uploadTitle")}</h3>
          <p className="text-xs text-ink-500">{t("uploadSubtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept=".xlsx"
            className="max-w-80"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setIssues([]);
            }}
          />
          <Button type="button" disabled={!file || pending} onClick={upload}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {t("checkChanges")}
          </Button>
        </div>

        {issues.length > 0 ? (
          <div className="space-y-1 rounded-lg border border-state-bad/30 bg-state-bad/8 p-3">
            <p className="flex items-center gap-2 text-xs font-semibold text-state-bad">
              <AlertTriangle className="size-4" />
              {t("blockingErrors", { count: issues.length })}
            </p>
            <ul className="space-y-0.5">
              {issues.map((issue, index) => (
                <IssueLine key={index} issue={issue} className="text-xs text-state-bad" t={t} />
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* Preview */}
      {preview && diff ? (
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">
                {t("previewTitle")} · <span className="font-data">{preview.regulationCode}</span>
              </h3>
              <p className="text-xs text-ink-500">
                {preview.isNewRegulation ? t("willCreate") : t("willUpdate")}
              </p>
            </div>
            <span className="rounded-full border border-line bg-surface-alt px-2.5 py-1 text-xs text-ink-600">
              {t(`service.${preview.serviceCode}` as "service.SAB-001")}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <CountBadge label={t("diff.standardsAdded")} value={diff.standards.added.length} tone="border-state-ok/30 bg-state-ok/10 text-state-ok" />
            <CountBadge label={t("diff.standardsUpdated")} value={diff.standards.updated.length} tone="border-line bg-surface-alt text-ink-600" />
            <CountBadge label={t("diff.itemsAdded")} value={diff.tariffItems.added.length} tone="border-state-ok/30 bg-state-ok/10 text-state-ok" />
            <CountBadge label={t("diff.itemsUpdated")} value={diff.tariffItems.updated.length} tone="border-line bg-surface-alt text-ink-600" />
            <CountBadge label={t("diff.itemsUnchanged")} value={diff.tariffItems.unchanged} tone="border-line bg-surface-alt text-ink-500" />
          </div>

          <ul className="space-y-1">
            <ChecklistDiffRow label={t("diff.generalChecklist")} diff={diff.generalChecklist} t={t} />
            <ChecklistDiffRow label={t("diff.labelingChecklist")} diff={diff.labelingChecklist} t={t} />
            <ChecklistDiffRow label={t("diff.documentsChecklist")} diff={diff.documentsChecklist} t={t} />
          </ul>

          {diff.tariffItems.absentFromSheet.length > 0 || diff.standards.absentFromSheet.length > 0 ? (
            <p className="rounded-lg border border-line bg-surface-alt/60 p-2 text-xs text-ink-600">
              {t("diff.absentNote", {
                items: diff.tariffItems.absentFromSheet.length,
                standards: diff.standards.absentFromSheet.length,
              })}
            </p>
          ) : null}

          {diff.evaluationsReferencingRegulation > 0 ? (
            <p className="rounded-lg border border-line bg-surface-alt/60 p-2 text-xs text-ink-600">
              {t("diff.evaluationsNote", { count: diff.evaluationsReferencingRegulation })}
            </p>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div className="space-y-1 rounded-lg border border-state-warn/30 bg-state-warn/8 p-3">
              <p className="text-xs font-semibold text-state-warn">
                {t("warnings", { count: preview.warnings.length })}
              </p>
              <ul className="space-y-0.5">
                {preview.warnings.slice(0, 20).map((warning, index) => (
                  <IssueLine key={index} issue={warning} className="text-xs text-state-warn" t={t} />
                ))}
                {preview.warnings.length > 20 ? (
                  <li className="text-xs text-state-warn">{t("moreWarnings", { count: preview.warnings.length - 20 })}</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" disabled={pending} onClick={discard}>
              <X className="size-4" />
              {t("discard")}
            </Button>
            <Button type="button" disabled={pending || preview.noChanges} onClick={apply}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t("apply")}
            </Button>
          </div>
        </section>
      ) : null}

      {/* History */}
      <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-semibold text-ink-900">{t("historyTitle")}</h3>
        {history.length === 0 ? (
          <p className="text-xs text-ink-500">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {history.map((row) => {
              const linkable = knownRegulationCodes.has(row.regulationCode);
              const content = (
                <>
                  <span className="flex flex-col">
                    <span className="text-ink-900">
                      <span className="font-data">{row.regulationCode}</span> · {row.sourceFilename}
                    </span>
                    <span className="text-ink-500">
                      {row.uploadedBy} · {row.uploadedAt}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 font-medium",
                        row.status === "APPLIED"
                          ? "border-state-ok/30 bg-state-ok/12 text-state-ok"
                          : row.status === "PENDING"
                            ? "border-state-warn/30 bg-state-warn/12 text-state-warn"
                            : "border-line bg-surface-alt text-ink-500",
                      )}
                    >
                      {t(`status.${row.status}` as "status.APPLIED")}
                    </span>
                    {linkable ? (
                      <ChevronRight className="size-3.5 text-ink-400 rtl:rotate-180" aria-hidden />
                    ) : null}
                  </span>
                </>
              );
              return (
                <li key={row.id}>
                  {linkable ? (
                    <Link
                      href={`/${locale}/admin/eval-catalog?regulation=${encodeURIComponent(row.regulationCode)}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-surface-alt"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
