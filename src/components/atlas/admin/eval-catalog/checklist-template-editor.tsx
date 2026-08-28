"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/server/admin/workflow-actions";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export type ChecklistItem = {
  code: string;
  titleEn: string;
  titleAr: string;
  /** The regulation clause this row cites, shown under the item at evaluation time. */
  applicability?: string;
  /** "conditional" when the row only applies in certain cases. */
  priority?: string;
};

function emptyItem(): ChecklistItem {
  return { code: "", titleEn: "", titleAr: "" };
}

/**
 * Generic add/edit/delete checklist-item-list editor, reused for all three
 * eval-catalog templates (regulation general checklist, regulation labeling
 * checklist, per-standard checklist) — same flat-item-list shape and save
 * flow as TechnicalReviewChecklistEditor, parameterized by an onSave
 * callback instead of one hardcoded server action.
 */
export function ChecklistTemplateEditor({
  title,
  subtitle,
  initial,
  onSave,
  editable,
}: {
  title: string;
  subtitle?: string;
  initial: ChecklistItem[];
  onSave: (items: ChecklistItem[]) => Promise<ActionResult>;
  editable: boolean;
}) {
  const t = useTranslations("adminOps.evalCatalog.checklistEditor");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [items, setItems] = useState<ChecklistItem[]>(
    initial.length > 0 ? initial : [emptyItem()],
  );
  const [pending, startTransition] = useTransition();

  if (!editable) {
    return (
      <div className="space-y-2">
        <div>
          <h4 className="text-sm font-semibold text-ink-900">{title}</h4>
          {subtitle ? <p className="text-xs text-ink-500">{subtitle}</p> : null}
        </div>
        {initial.length === 0 ? (
          <p className="text-xs text-ink-500">{t("empty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {initial.map((item, idx) => (
              <li key={item.code} className="px-3 py-2 text-sm text-ink-900">
                <span className="font-data text-xs text-ink-400">{idx + 1}.</span>{" "}
                {isAr ? item.titleAr : item.titleEn}
                {item.applicability ? (
                  <span className="block text-xs text-ink-500">{item.applicability}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  function update(index: number, patch: Partial<ChecklistItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function save() {
    // applicability/priority are carried through untouched: they come from the
    // source regulation and are not editable here, so dropping them would make
    // the first save silently strip every clause reference.
    const cleaned = items
      .map((it) => ({
        code: it.code.trim().toUpperCase().replace(/\s+/g, "_"),
        titleEn: it.titleEn.trim(),
        titleAr: it.titleAr.trim(),
        ...(it.applicability ? { applicability: it.applicability } : {}),
        ...(it.priority ? { priority: it.priority } : {}),
      }))
      .filter((it) => it.code && it.titleEn && it.titleAr);

    if (cleaned.length === 0) {
      toast.error(t("errors.VALIDATION"));
      return;
    }

    startTransition(async () => {
      const result = await onSave(cleaned);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setItems(cleaned);
      toast.success(t("saved"));
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold text-ink-900">{title}</h4>
        {subtitle ? <p className="text-xs text-ink-500">{subtitle}</p> : null}
      </div>

      <ul className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="space-y-3 rounded-lg border border-line bg-surface p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">#{index + 1}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                aria-label={t("remove")}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("code")}</Label>
                <Input
                  value={item.code}
                  onChange={(e) => update(index, { code: e.target.value })}
                  dir="ltr"
                  className="font-data"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("titleEn")}</Label>
                <Input value={item.titleEn} onChange={(e) => update(index, { titleEn: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("titleAr")}</Label>
                <Input
                  value={item.titleAr}
                  onChange={(e) => update(index, { titleAr: e.target.value })}
                  dir="rtl"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
          <Plus className="size-4" />
          {t("addItem")}
        </Button>
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
