"use client";

import { RegulationPanel } from "@/components/atlas/admin/eval-catalog/regulation-panel";
import { EmptyState } from "@/components/atlas/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EvalCatalogRegulation } from "@/server/admin/queries";
import { TARIFF_EVAL_SERVICE_CODES } from "@/lib/tariff-evaluation-services";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";

type Props = {
  regulations: EvalCatalogRegulation[];
  canEditGeneral: boolean;
  canEditSpecific: boolean;
};

/** Groups regulations by service (SAB-001 / SFDA-COS-002) into tabs, one RegulationPanel per regulation. */
export function EvalCatalogView({ regulations, canEditGeneral, canEditSpecific }: Props) {
  const t = useTranslations("adminOps.evalCatalog");

  const services = TARIFF_EVAL_SERVICE_CODES;

  return (
    <Tabs defaultValue={services[0]} className="w-full">
      <TabsList>
        {services.map((code) => (
          <TabsTrigger key={code} value={code}>
            {t(`service.${code}` as "service.SAB-001")}
          </TabsTrigger>
        ))}
      </TabsList>
      {services.map((code) => {
        const forService = regulations.filter((r) => r.serviceCode === code);
        return (
          <TabsContent key={code} value={code} className="space-y-4">
            {forService.length === 0 ? (
              <EmptyState icon={ClipboardList} title={t("noRegulationsTitle")} description={t("noRegulationsDescription")} />
            ) : (
              forService.map((regulation) => (
                <RegulationPanel
                  key={regulation.id}
                  regulation={regulation}
                  canEditGeneral={canEditGeneral}
                  canEditSpecific={canEditSpecific}
                />
              ))
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
