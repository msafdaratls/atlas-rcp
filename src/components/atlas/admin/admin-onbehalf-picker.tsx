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
}: {
  clients: OnBehalfClientOption[];
}) {
  const t = useTranslations("adminOps.requests.onBehalf");
  const locale = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<string>("");
  const [pending, startTransition] = useTransition();

  function onContinue() {
    if (!selected) return;
    startTransition(async () => {
      const result = await startRequestOnBehalf(selected);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.FAILED"));
        return;
      }
      router.refresh();
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
