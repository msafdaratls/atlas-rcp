"use client";

import { RegulationPanel } from "@/components/atlas/admin/eval-catalog/regulation-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EvalCatalogRegulation } from "@/server/admin/queries";
import { TARIFF_EVAL_SERVICE_CODES } from "@/lib/tariff-evaluation-services";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/**
 * `EmptyState` (components/atlas/empty-state.tsx) is an async Server
 * Component — it awaits `getTranslations` from "next-intl/server". A Client
 * Component may receive one as `children` from a Server Component ancestor,
 * but can never import and instantiate it directly: React throws (minified
 * error #482) the moment that branch actually renders. This view needs
 * "use client" for the Tabs, so it gets its own client-safe copy instead of
 * carrying that same trap into a second file.
 */
function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line bg-surface-alt px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-lg border border-line bg-surface text-atlas-green">
        <ClipboardList className="size-6" aria-hidden />
      </div>
      <div className="max-w-md space-y-1">
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        <p className="text-sm text-ink-500">{description}</p>
      </div>
    </div>
  );
}

type Props = {
  regulations: EvalCatalogRegulation[];
  canEditGeneral: boolean;
  canEditSpecific: boolean;
  /** Regulation code to land on and highlight, e.g. arriving from an import-history row. */
  focusCode?: string;
};

/** Groups regulations by service (SAB-001 / SFDA-COS-002) into tabs, one RegulationPanel per regulation. */
export function EvalCatalogView({ regulations, canEditGeneral, canEditSpecific, focusCode }: Props) {
  const t = useTranslations("adminOps.evalCatalog");

  const services = TARIFF_EVAL_SERVICE_CODES;
  const focusRegulation = focusCode ? regulations.find((r) => r.code === focusCode) : undefined;
  const [activeTab, setActiveTab] = useState(focusRegulation?.serviceCode ?? services[0]);
  const focusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusRegulation) {
      focusRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // Only run once on arrival — the highlight/scroll is a one-time landing cue, not a live sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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
              <EmptyState title={t("noRegulationsTitle")} description={t("noRegulationsDescription")} />
            ) : (
              forService.map((regulation) => (
                <div
                  key={regulation.id}
                  ref={regulation.code === focusCode ? focusRef : undefined}
                  className={cn(
                    regulation.code === focusCode &&
                      "rounded-xl ring-2 ring-atlas-green ring-offset-2 ring-offset-surface-alt",
                  )}
                >
                  <RegulationPanel
                    regulation={regulation}
                    canEditGeneral={canEditGeneral}
                    canEditSpecific={canEditSpecific}
                  />
                </div>
              ))
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
