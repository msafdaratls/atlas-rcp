"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OnBehalfClientOption } from "@/server/admin/queries";
import {
  endRequestOnBehalf,
  startRequestOnBehalf,
} from "@/server/requests/on-behalf";

export function AdminOnBehalfPicker({
  clients,
  defaultOrgId = "",
}: {
  clients: OnBehalfClientOption[];
  /** Pre-selects a client (e.g. one pinned from an earlier visit) without
   * skipping the picker entirely — the staff member still has to confirm it
   * with one click, so a stale pin from a previous session can never
   * silently carry a request into the wrong client's account. */
  defaultOrgId?: string;
}) {
  const t = useTranslations("adminOps.requests.onBehalf");
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string>(defaultOrgId);
  const [pending, startTransition] = useTransition();

  function onContinue() {
    if (!selected) return;
    startTransition(async () => {
      const result = await startRequestOnBehalf(selected);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.FAILED"));
        return;
      }
      // A plain refresh would re-run the page with the same URL, and the
      // page only trusts the pin for a deep link — a `refresh()` here would
      // just show this same picker again. Marking the navigation as
      // explicitly confirmed is what lets the page move on to the wizard.
      router.push(`/${locale}/admin/requests/new?confirmed=1`);
    });
  }

  if (clients.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-surface-alt p-6 text-center">
        <p className="text-sm text-ink-500">{t("noClients")}</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href={`/${locale}/admin/clients`}>{t("createClientCta")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-4 rounded-lg border border-line bg-surface-alt p-6">
      <p className="text-sm text-ink-500">{t("description")}</p>
      <div className="space-y-1.5">
        <Label htmlFor="onbehalf-client">{t("selectLabel")}</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="onbehalf-client">
            <SelectValue placeholder={t("selectPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {locale === "ar" ? c.nameAr : c.nameEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" onClick={onContinue} disabled={!selected || pending}>
        {t("continue")}
      </Button>
    </div>
  );
}

export function AdminOnBehalfBanner({ clientName }: { clientName: string }) {
  const t = useTranslations("adminOps.requests.onBehalf");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange() {
    startTransition(async () => {
      await endRequestOnBehalf();
      router.refresh();
    });
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-atlas-green/30 bg-atlas-green/5 px-4 py-3">
      <p className="text-sm text-ink-800">
        {t("banner", { client: clientName })}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onChange}
        disabled={pending}
      >
        {t("change")}
      </Button>
    </div>
  );
}
