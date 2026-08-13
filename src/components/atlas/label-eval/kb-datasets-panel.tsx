"use client";

import type { LabelEvalDomain } from "@prisma/client";
import { CheckCircle2, Loader2, RotateCcw, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { activateKbWorkbook, uploadKbWorkbook } from "@/server/label-eval/kb/actions";
import type { KbDiffResult } from "@/server/label-eval/kb/versioning";
import type { KbVersionRow } from "@/server/label-eval/queries";

type Props = { domain: LabelEvalDomain; versions: KbVersionRow[] };

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-state-ok/12 text-state-ok border-state-ok/30",
  DRAFT: "bg-state-warn/12 text-state-warn border-state-warn/30",
  ARCHIVED: "bg-surface-alt text-ink-500 border-line",
};

export function KbDatasetsPanel({ domain, versions }: Props) {
  const t = useTranslations("labelEval.datasets");
  const tErrors = useTranslations("labelEval.errors");
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploadPending, startUpload] = useTransition();
  const [activatePending, startActivate] = useTransition();
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [result, setResult] = useState<{ versionId: string; diff: KbDiffResult; warnings: string[] } | null>(null);

  const active = versions.find((v) => v.status === "ACTIVE") ?? null;

  function upload() {
    if (!file) return;
    startUpload(async () => {
      const formData = new FormData();
      formData.set("domain", domain);
      formData.set("file", file);
      const res = await uploadKbWorkbook(formData);
      if (!res.ok) {
        const [code, ...rest] = res.error.split(":");
        const detail = rest.join(":");
        toast.error(tErrors(code as "UPLOAD_FAILED", detail ? { label: detail } : undefined));
        return;
      }
      setResult(res.data);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast.success(t("uploaded"));
      router.refresh();
    });
  }

  function activate(versionId: string) {
    setActivatingId(versionId);
    startActivate(async () => {
      const res = await activateKbWorkbook({ versionId, domain });
      setActivatingId(null);
      if (!res.ok) {
        toast.error(tErrors(res.error as "ACTIVATE_FAILED"));
        return;
      }
      toast.success(t("activated"));
      setResult(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("activeVersion")}</h2>
        {active ? (
          <div className="mt-2 flex items-center gap-3 text-sm">
            <CheckCircle2 className="size-4 text-state-ok" />
            <span className="font-data text-ink-800">{active.versionLabel}</span>
            <span className="text-ink-500">{t("counts", { rules: active.ruleCount, lookups: active.lookupCount })}</span>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-500">{t("none")}</p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink-900">{t("uploadTitle")}</h2>
        <p className="mt-1 text-xs text-ink-500">{t("description")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-xs"
          />
          <Button disabled={!file || uploadPending} onClick={upload}>
            {uploadPending ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
            {uploadPending ? t("uploading") : t("upload")}
          </Button>
        </div>

        {result ? (
          <div className="mt-4 space-y-3 rounded-md border border-line bg-surface-alt/40 p-3">
            <h3 className="text-sm font-semibold text-ink-900">{t("diffTitle")}</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-state-ok/30 bg-state-ok/10 px-2 py-1 text-state-ok">
                {t("added", { count: result.diff.addedCodes.length })}
              </span>
              <span className="rounded-full border border-state-bad/30 bg-state-bad/10 px-2 py-1 text-state-bad">
                {t("removed", { count: result.diff.removedCodes.length })}
              </span>
              <span className="rounded-full border border-state-warn/30 bg-state-warn/10 px-2 py-1 text-state-warn">
                {t("changed", { count: result.diff.changedCodes.length })}
              </span>
              <span className="rounded-full border border-line bg-surface px-2 py-1 text-ink-600">
                {t("unchanged", { count: result.diff.unchangedCount })}
              </span>
            </div>

            {result.warnings.length > 0 ? (
              <div>
                <h4 className="text-xs font-semibold text-ink-700">{t("warningsTitle")}</h4>
                <ul className="mt-1 space-y-1 text-xs text-ink-600">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="rounded border border-line bg-surface px-2 py-1">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Button
              size="sm"
              disabled={activatePending}
              onClick={() => activate(result.versionId)}
            >
              {activatePending && activatingId === result.versionId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : null}
              {t("activate")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-900">{t("history")}</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-surface-alt/60 text-xs text-ink-500">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("columns.version")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.status")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.uploaded")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("columns.activated")}</th>
              <th className="px-3 py-2 text-end font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2">
                  <p className="font-data text-ink-800">{v.versionLabel}</p>
                  <p className="text-xs text-ink-500">{t("counts", { rules: v.ruleCount, lookups: v.lookupCount })}</p>
                </td>
                <td className="px-3 py-2">
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_TONE[v.status])}>
                    {t(`status.${v.status}` as "status.DRAFT")}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-600" dir="ltr">
                  {new Date(v.uploadedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-ink-600" dir="ltr">
                  {v.activatedAt ? new Date(v.activatedAt).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-end">
                  {v.status === "ARCHIVED" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={activatePending}
                      onClick={() => activate(v.id)}
                    >
                      {activatePending && activatingId === v.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                      {t("rollback")}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
