"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAtlasOrganisation } from "@/server/admin/actions";
import type { AtlasSettings } from "@/server/admin/queries";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = { data: AtlasSettings };

export function AdminSettingsForm({ data }: Props) {
  const t = useTranslations("adminOps.settings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const nameEn = String(fd.get("nameEn") ?? "").trim();
    const nameAr = String(fd.get("nameAr") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    const phone = String(fd.get("phone") ?? "").trim();

    startTransition(async () => {
      const result = await updateAtlasOrganisation({
        nameEn,
        nameAr,
        email,
        phone: phone.length > 0 ? phone : null,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-xl space-y-4 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink-900">{t("orgTitle")}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="nameEn">{t("nameEn")}</Label>
          <Input
            id="nameEn"
            name="nameEn"
            defaultValue={data.nameEn}
            required
            minLength={2}
            maxLength={200}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="nameAr">{t("nameAr")}</Label>
          <Input
            id="nameAr"
            name="nameAr"
            defaultValue={data.nameAr}
            required
            minLength={2}
            maxLength={200}
            dir="rtl"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={data.email}
            required
            dir="ltr"
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="phone">{t("phone")}</Label>
          <Input
            id="phone"
            name="phone"
            defaultValue={data.phone ?? ""}
            maxLength={30}
            dir="ltr"
            className="mt-1"
          />
        </div>
      </div>

      {data.website ? (
        <div>
          <Label>{t("website")}</Label>
          <p className="mt-1 text-sm text-ink-500" dir="ltr">
            {data.website}
          </p>
        </div>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {t("save")}
      </Button>
    </form>
  );
}
