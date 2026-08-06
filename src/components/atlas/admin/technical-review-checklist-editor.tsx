"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveTechnicalReviewChecklistDefinition } from "@/server/admin/actions";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type ChecklistItem = { code: string; titleEn: string; titleAr: string };

function emptyItem(): ChecklistItem {
  return { code: "", titleEn: "", titleAr: "" };
}

/**
 * Admin editor for the single global Technical Review meta-checklist — the
 * doc's "configurable" review checklist (Evaluation Report reviewed /
 * standards verified / etc.), shown to the Technical Reviewer on every
 * request. Trimmed version of the per-service checklist editor in
 * create-service-wizard.tsx: one flat item list, no attribute schema.
 */
export function TechnicalReviewChecklistEditor({
  initial,
}: {
  initial: ChecklistItem[];
}) {
  const t = useTranslations("adminOps.settings.technicalReviewChecklist");
  const [items, setItems] = useState<ChecklistItem[]>(
    initial.length > 0 ? initial : [emptyItem()],
  );
  const [pending, startTransition] = useTransition();

  function update(index: number, patch: Partial<ChecklistItem>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }

  function save() {
    const cleaned = items
      .map((it) => ({
        code: it.code.trim().toUpperCase().replace(/\s+/g, "_"),
        titleEn: it.titleEn.trim(),
        titleAr: it.titleAr.trim(),
      }))
      .filter((it) => it.code && it.titleEn && it.titleAr);

    if (cleaned.length === 0) {
      toast.error(t("errors.VALIDATION"));
      return;
    }

    startTransition(async () => {
      const result = await saveTechnicalReviewChecklistDefinition({
        items: cleaned,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setItems(cleaned);
      toast.success(t("saved"));
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{t("title")}</h3>
        <p className="text-xs text-ink-500">{t("subtitle")}</p>
      </div>

      <ul className="space-y-3">
        {items.map((item, index) => (
          <li
            key={index}
            className="space-y-3 rounded-lg border border-line bg-surface p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">
                #{index + 1}
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() =>
                  setItems((prev) => prev.filter((_, i) => i !== index))
                }
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
                <Input
                  value={item.titleEn}
                  onChange={(e) => update(index, { titleEn: e.target.value })}
                />
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
        <Button
          type="button"
          variant="secondary"
          onClick={() => setItems((prev) => [...prev, emptyItem()])}
        >
          <Plus className="size-4" />
          {t("addItem")}
        </Button>
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}
