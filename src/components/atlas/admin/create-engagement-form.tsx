"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createEngagement } from "@/server/admin/engagements";

type ClientOption = { id: string; nameEn: string; nameAr: string };
type ServiceOption = { id: string; nameEn: string; nameAr: string };

export function CreateEngagementForm({
  clients,
  services,
  locale,
}: {
  clients: ClientOption[];
  services: ServiceOption[];
  locale: string;
}) {
  const t = useTranslations("adminOps.engagements");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [organisationId, setOrganisationId] = useState("");
  const [serviceItemId, setServiceItemId] = useState("");
  const [notes, setNotes] = useState("");

  function handleCreate() {
    if (!organisationId || !serviceItemId) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    startTransition(async () => {
      const result = await createEngagement({
        organisationId,
        serviceItemId,
        notes: notes.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setOpen(false);
      setOrganisationId("");
      setServiceItemId("");
      setNotes("");
      toast.success(t("created"));
      router.push(`/${locale}/admin/engagements/${result.data.id}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t("create")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("create")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("client")}</Label>
            <Select value={organisationId} onValueChange={setOrganisationId}>
              <SelectTrigger>
                <SelectValue placeholder={t("selectClient")} />
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
          <div className="space-y-2">
            <Label>{t("service")}</Label>
            <Select value={serviceItemId} onValueChange={setServiceItemId}>
              <SelectTrigger>
                <SelectValue placeholder={t("selectService")} />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {locale === "ar" ? s.nameAr : s.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("notes")}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={pending} onClick={handleCreate}>
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
