"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCoupon } from "@/server/admin/actions";
import type { CouponCreateOptions } from "@/server/admin/queries";
import type { CouponDiscountType } from "@prisma/client";
import { Loader2, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type AppliesTo = "ALL" | "MAIN_CATEGORY" | "SUB_CATEGORY" | "SERVICE_ITEM";
type ClientScope = "ALL" | "SPECIFIC" | "NEW_CLIENTS_ONLY";

/**
 * A `datetime-local` value is a wall-clock string with no timezone. `new Date(v)`
 * reads it as local time, which — once stored and rendered from its UTC ISO
 * string — can shift the calendar date by a day. Anchoring the same wall-clock
 * value to UTC makes the stored and displayed date match what the admin typed.
 */
function localInputToUtc(v: string): Date {
  const [datePart, timePart = "00:00"] = v.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0));
}

type Props = {
  options: CouponCreateOptions;
};

export function CreateCouponForm({ options }: Props) {
  const t = useTranslations("adminOps.coupons.create");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [discountType, setDiscountType] = useState<CouponDiscountType>("PERCENT");
  const [value, setValue] = useState("");
  const [maxDiscountAmount, setMaxDiscountAmount] = useState("");
  const [minOrderAmount, setMinOrderAmount] = useState("");
  const [appliesTo, setAppliesTo] = useState<AppliesTo>("ALL");
  const [appliesToIds, setAppliesToIds] = useState<string[]>([]);
  const [clientScope, setClientScope] = useState<ClientScope>("ALL");
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [totalUsageLimit, setTotalUsageLimit] = useState("");
  const [perClientLimit, setPerClientLimit] = useState("");
  const [stackable, setStackable] = useState(false);
  const [excludesResubmissions, setExcludesResubmissions] = useState(true);

  const scopeOptions = useMemo(() => {
    if (appliesTo === "MAIN_CATEGORY") return options.mains;
    if (appliesTo === "SUB_CATEGORY") return options.subs;
    if (appliesTo === "SERVICE_ITEM") return options.serviceItems;
    return [];
  }, [appliesTo, options]);

  const needsScopeIds = appliesTo !== "ALL";
  const needsClientIds = clientScope === "SPECIFIC";

  const canSubmit =
    code.trim().length >= 2 &&
    nameEn.trim().length >= 2 &&
    nameAr.trim().length >= 2 &&
    Number(value) > 0 &&
    value.trim().length > 0 &&
    Boolean(validFrom) &&
    Boolean(validTo) &&
    (!needsScopeIds || appliesToIds.length > 0) &&
    (!needsClientIds || clientIds.length > 0);

  function resetForm() {
    setCode("");
    setNameEn("");
    setNameAr("");
    setDiscountType("PERCENT");
    setValue("");
    setMaxDiscountAmount("");
    setMinOrderAmount("");
    setAppliesTo("ALL");
    setAppliesToIds([]);
    setClientScope("ALL");
    setClientIds([]);
    setValidFrom("");
    setValidTo("");
    setTotalUsageLimit("");
    setPerClientLimit("");
    setStackable(false);
    setExcludesResubmissions(true);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function toggleId(
    list: string[],
    setList: (next: string[]) => void,
    id: string,
    checked: boolean,
  ) {
    setList(checked ? [...list, id] : list.filter((x) => x !== id));
  }

  function onSubmit() {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await createCoupon({
        code: code.trim().toUpperCase(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        discountType,
        value: value.trim(),
        maxDiscountAmount: maxDiscountAmount.trim() || undefined,
        minOrderAmount: minOrderAmount.trim() || undefined,
        appliesTo,
        appliesToIds: appliesTo === "ALL" ? [] : appliesToIds,
        clientScope,
        clientIds: clientScope === "SPECIFIC" ? clientIds : [],
        validFrom: localInputToUtc(validFrom),
        validTo: localInputToUtc(validTo),
        totalUsageLimit: totalUsageLimit.trim()
          ? Number(totalUsageLimit)
          : undefined,
        perClientLimit: perClientLimit.trim() ? Number(perClientLimit) : undefined,
        stackable,
        excludesResubmissions,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">
          <Plus className="size-4" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pe-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("code")}</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                dir="ltr"
                className="font-data"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("discountType")}</Label>
              <Select
                value={discountType}
                onValueChange={(v) => setDiscountType(v as CouponDiscountType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">
                    {t("discountTypes.PERCENT")}
                  </SelectItem>
                  <SelectItem value="FIXED">{t("discountTypes.FIXED")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("nameEn")}</Label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("nameAr")}</Label>
              <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("value")}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("maxDiscountAmount")}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={maxDiscountAmount}
                onChange={(e) => setMaxDiscountAmount(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("minOrderAmount")}</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("appliesTo")}</Label>
              <Select
                value={appliesTo}
                onValueChange={(v) => {
                  setAppliesTo(v as AppliesTo);
                  setAppliesToIds([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    [
                      "ALL",
                      "MAIN_CATEGORY",
                      "SUB_CATEGORY",
                      "SERVICE_ITEM",
                    ] as const
                  ).map((key) => (
                    <SelectItem key={key} value={key}>
                      {t(`appliesToOptions.${key}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("clientScope")}</Label>
              <Select
                value={clientScope}
                onValueChange={(v) => {
                  setClientScope(v as ClientScope);
                  setClientIds([]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["ALL", "SPECIFIC", "NEW_CLIENTS_ONLY"] as const).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {t(`clientScopeOptions.${key}`)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("validFrom")}</Label>
              <Input
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("validTo")}</Label>
              <Input
                type="datetime-local"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("totalUsageLimit")}</Label>
              <Input
                type="number"
                min={1}
                value={totalUsageLimit}
                onChange={(e) => setTotalUsageLimit(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("perClientLimit")}</Label>
              <Input
                type="number"
                min={1}
                value={perClientLimit}
                onChange={(e) => setPerClientLimit(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>

          {needsScopeIds ? (
            <fieldset className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-ink-800">
                {t("appliesToIds")}
              </legend>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {scopeOptions.length === 0 ? (
                  <p className="text-sm text-ink-500">{t("appliesToIdsEmpty")}</p>
                ) : (
                  scopeOptions.map((row) => (
                    <label
                      key={row.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={appliesToIds.includes(row.id)}
                        onCheckedChange={(v) =>
                          toggleId(
                            appliesToIds,
                            setAppliesToIds,
                            row.id,
                            Boolean(v),
                          )
                        }
                      />
                      <span>
                        {locale === "ar" ? row.nameAr : row.nameEn}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          ) : null}

          {needsClientIds ? (
            <fieldset className="space-y-2 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold text-ink-800">
                {t("clientIds")}
              </legend>
              <div className="max-h-40 space-y-2 overflow-y-auto">
                {options.clients.length === 0 ? (
                  <p className="text-sm text-ink-500">{t("clientIdsEmpty")}</p>
                ) : (
                  options.clients.map((client) => (
                    <label
                      key={client.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={clientIds.includes(client.id)}
                        onCheckedChange={(v) =>
                          toggleId(
                            clientIds,
                            setClientIds,
                            client.id,
                            Boolean(v),
                          )
                        }
                      />
                      <span>
                        {locale === "ar" ? client.nameAr : client.nameEn}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={stackable}
              onCheckedChange={(v) => setStackable(Boolean(v))}
            />
            {t("stackable")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={excludesResubmissions}
              onCheckedChange={(v) => setExcludesResubmissions(Boolean(v))}
            />
            {t("excludesResubmissions")}
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={!canSubmit || pending} onClick={onSubmit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
