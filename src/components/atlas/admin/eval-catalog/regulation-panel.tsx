"use client";

import { ChecklistTemplateEditor } from "@/components/atlas/admin/eval-catalog/checklist-template-editor";
import { TariffItemBrowser } from "@/components/atlas/admin/eval-catalog/tariff-item-browser";
import { cn } from "@/lib/utils";
import {
  saveDocumentsChecklist,
  saveGeneralChecklist,
  saveLabelingChecklist,
  saveSpecificStandardChecklist,
} from "@/server/admin/eval-catalog-actions";
import type { EvalCatalogRegulation } from "@/server/admin/queries";
import { useLocale, useTranslations } from "next-intl";

type Props = {
  regulation: EvalCatalogRegulation;
  canEditGeneral: boolean;
  canEditSpecific: boolean;
};

/**
 * One technical regulation's full catalog: general checklist, labeling
 * checklist, every standard (general or specific, each its own checklist
 * template), and a read-only browser over its tariff-item catalog.
 */
export function RegulationPanel({ regulation, canEditGeneral, canEditSpecific }: Props) {
  const t = useTranslations("adminOps.evalCatalog");
  const locale = useLocale();
  const isAr = locale === "ar";

  return (
    <div className="space-y-6 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{isAr ? regulation.titleAr : regulation.titleEn}</h3>
          <p className="font-data text-xs text-ink-500">{regulation.code}</p>
        </div>
        <span className="rounded-full border border-line bg-surface-alt px-2.5 py-1 text-xs font-medium text-ink-600">
          {t("tariffItemCount", { count: regulation.tariffItemCount })}
        </span>
      </div>

      <ChecklistTemplateEditor
        title={t("generalChecklist")}
        subtitle={t("generalChecklistSubtitle")}
        initial={regulation.generalItems}
        onSave={(items) => saveGeneralChecklist({ technicalRegulationId: regulation.id, items })}
        editable={canEditGeneral}
      />

      <ChecklistTemplateEditor
        title={t("labelingChecklist")}
        subtitle={t("labelingChecklistSubtitle")}
        initial={regulation.labelingItems}
        onSave={(items) => saveLabelingChecklist({ technicalRegulationId: regulation.id, items })}
        editable={canEditGeneral}
      />

      <ChecklistTemplateEditor
        title={t("documentsChecklist")}
        subtitle={t("documentsChecklistSubtitle")}
        initial={regulation.documentsItems}
        onSave={(items) => saveDocumentsChecklist({ technicalRegulationId: regulation.id, items })}
        editable={canEditGeneral}
      />

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-ink-900">{t("standards")}</h4>
        <p className="text-xs text-ink-500">{t("standardsSubtitle")}</p>
        <div className="space-y-2">
          {regulation.standards.map((standard) => {
            const editable = standard.kind === "GENERAL" ? canEditGeneral : canEditSpecific;
            return (
              <details key={standard.id} className="rounded-lg border border-line">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-data text-xs text-ink-500">{standard.code}</span>
                    <span className="text-ink-900">{isAr ? standard.titleAr : standard.titleEn}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        standard.kind === "GENERAL"
                          ? "border-line bg-surface-alt text-ink-600"
                          : "border-state-warn/30 bg-state-warn/12 text-state-warn",
                      )}
                    >
                      {t(`standardKind.${standard.kind}`)}
                    </span>
                    <span className="text-xs text-ink-500">{t("itemCount", { count: standard.itemCount })}</span>
                  </span>
                </summary>
                <div className="border-t border-line p-3">
                  <ChecklistTemplateEditor
                    title={t("standardChecklist")}
                    initial={standard.items}
                    onSave={(items) => saveSpecificStandardChecklist({ standardId: standard.id, items })}
                    editable={editable}
                  />
                  {standard.itemCount === 0 ? (
                    <p className="mt-2 text-xs text-ink-500">{t("standardEmptyHint")}</p>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-ink-900">{t("tariffItems")}</h4>
        <TariffItemBrowser technicalRegulationId={regulation.id} />
      </div>
    </div>
  );
}
