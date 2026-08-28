"use client";

import { Input } from "@/components/ui/input";
import { listTariffItemsForRegulation } from "@/server/admin/tariff-evaluation-actions";
import { Loader2, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

/**
 * Read-only search view over a regulation's tariff-item catalog (up to
 * 1,527 rows for the seeded textile regulation) — lets Quality/CoC verify
 * what was imported without needing bulk CRUD on day one. Uses the same
 * listTariffItemsForRegulation action TariffEvaluationPanel's HS-code
 * picker calls at runtime.
 */
export function TariffItemBrowser({ technicalRegulationId }: { technicalRegulationId: string }) {
  const t = useTranslations("adminOps.evalCatalog.tariffItemBrowser");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{ id: string; hsCode: string; productTitleEn: string; productTitleAr: string }>
  >([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const result = await listTariffItemsForRegulation({ technicalRegulationId, query: query || undefined });
      if (result.ok) setResults(result.data);
    });
  }, [technicalRegulationId, query]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 -translate-y-1/2 size-4 text-ink-400 ltr:left-2.5 rtl:right-2.5" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="ltr:pl-8 rtl:pr-8"
          dir="ltr"
        />
      </div>
      {pending ? <Loader2 className="size-4 animate-spin text-ink-400" /> : null}
      <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
        {results.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-sm">
            <span className="font-data text-xs text-ink-400">{r.hsCode}</span>
            <span className="text-ink-900">{isAr ? r.productTitleAr : r.productTitleEn}</span>
          </li>
        ))}
        {results.length === 0 && !pending ? (
          <li className="px-3 py-2 text-xs text-ink-500">{t("empty")}</li>
        ) : null}
      </ul>
    </div>
  );
}
