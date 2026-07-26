"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createClientSchema,
  type CreateClientInput,
} from "@/lib/validators/admin";
import { createClientAction } from "@/server/admin/actions";

export function AdminCreateClientForm() {
  const t = useTranslations("adminOps.clients.create");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    defaultValues: {
      companyNameEn: "",
      companyNameAr: "",
      fullNameEn: "",
      fullNameAr: "",
      email: "",
      phone: "",
      password: "",
      locale: locale === "en" ? "en" : "ar",
    },
  });

  function onSubmit(values: CreateClientInput) {
    startTransition(async () => {
      const result = await createClientAction(values);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success", { email: result.data.email }));
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  const invalid = Object.keys(errors).length > 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t("trigger")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="grid gap-3 sm:grid-cols-2"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="companyNameEn">{t("companyNameEn")}</Label>
            <Input id="companyNameEn" dir="ltr" {...register("companyNameEn")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="companyNameAr">{t("companyNameAr")}</Label>
            <Input id="companyNameAr" dir="rtl" {...register("companyNameAr")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fullNameEn">{t("ownerNameEn")}</Label>
            <Input id="fullNameEn" dir="ltr" {...register("fullNameEn")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fullNameAr">{t("ownerNameAr")}</Label>
            <Input id="fullNameAr" dir="rtl" {...register("fullNameAr")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("email")}</Label>
            <Input id="email" type="email" dir="ltr" {...register("email")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{t("phone")}</Label>
            <Input
              id="phone"
              type="tel"
              dir="ltr"
              required
              placeholder="+9665XXXXXXXX"
              {...register("phone")}
            />
            <p className="text-xs text-ink-500">{t("phoneHint")}</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="text"
              dir="ltr"
              autoComplete="off"
              {...register("password")}
            />
            <p className="text-xs text-ink-500">{t("passwordHint")}</p>
          </div>

          {invalid ? (
            <p className="text-sm text-[var(--state-bad)] sm:col-span-2">
              {t("errors.VALIDATION")}
            </p>
          ) : null}

          <DialogFooter className="sm:col-span-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
