"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseAttrSchema } from "@/lib/attr-schema";
import { computePriceBreakdown } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import {
  applyCouponToDraft,
  createOrSelectDraft,
  removeCouponFromDraft,
  removeRequestDocument,
  saveDraftProductDetails,
  submitRequest,
  uploadRequestDocument,
} from "@/server/requests/actions";
import { endRequestOnBehalf } from "@/server/requests/on-behalf";
import { Pill, Sparkles, Upload, X } from "lucide-react";
import type {
  CataloguePayload,
  CatalogueServiceItem,
  DraftRequestView,
} from "@/server/requests/queries";

type PersistedWizardState = {
  requestId: string | null;
  step: number;
  mainId: string | null;
  subIds: string[];
  itemId: string | null;
  productNameEn: string;
  productNameAr: string;
  brand: string;
  attrs: Record<string, unknown>;
  couponCode: string;
  appliedCoupon: string | null;
  discount: number;
  artworkFinal: boolean;
};

type UploadSlotState = {
  requiredDocumentId: string | null;
  label: string;
  mandatory: boolean;
  acceptedMimeTypes: string[];
  maxSizeMb: number;
  documentId?: string;
  fileName?: string;
  mimeType?: string;
  previewUrl?: string;
  progress?: number;
};

type Props = {
  catalogue: CataloguePayload;
  initialDraft: DraftRequestView | null;
  initialMainId?: string | null;
  /** Where to send the user after submit (before the request id). */
  redirectBasePath?: string;
  /** True when an admin is creating on a client's behalf — clears the pin. */
  onBehalf?: boolean;
};

export function NewRequestWizard({
  catalogue,
  initialDraft,
  initialMainId,
  redirectBasePath = "/client/requests",
  onBehalf = false,
}: Props) {
  const t = useTranslations("newRequest");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [mainId, setMainId] = useState<string | null>(
    initialDraft ? null : initialMainId ?? null,
  );
  const [subIds, setSubIds] = useState<string[]>([]);
  const [itemId, setItemId] = useState<string | null>(
    initialDraft?.serviceItemId ?? null,
  );
  const [requestId, setRequestId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [requestNo, setRequestNo] = useState<string | null>(
    initialDraft?.requestNo ?? null,
  );
  const [expandedChecks, setExpandedChecks] = useState(false);

  const [productNameEn, setProductNameEn] = useState(
    initialDraft?.productNameEn ?? "",
  );
  const [productNameAr, setProductNameAr] = useState(
    initialDraft?.productNameAr ?? "",
  );
  const [brand, setBrand] = useState(initialDraft?.brand ?? "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>(
    initialDraft?.productAttrs ?? {},
  );

  const selectedItem: CatalogueServiceItem | null = useMemo(
    () => catalogue.items.find((i) => i.id === itemId) ?? null,
    [catalogue.items, itemId],
  );

  const selectedMain = catalogue.mains.find((m) => m.id === mainId) ?? null;
  const subs = catalogue.subs.filter((s) => s.mainCategoryId === mainId);
  const items = useMemo(
    () => catalogue.items.filter((i) => subIds.includes(i.subCategoryId)),
    [catalogue.items, subIds],
  );

  const [slots, setSlots] = useState<UploadSlotState[]>([]);

  useEffect(() => {
    if (!initialDraft) return;
    const item = catalogue.items.find((i) => i.id === initialDraft.serviceItemId);
    if (!item) return;
    const sub = catalogue.subs.find((s) => s.id === item.subCategoryId);
    if (sub) {
      setMainId(sub.mainCategoryId);
      setSubIds([sub.id]);
    }
    setSlots(buildSlots(item, initialDraft, t("step3.additional")));
  }, [initialDraft, catalogue, t]);

  const [couponCode, setCouponCode] = useState(initialDraft?.couponCode ?? "");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(
    initialDraft?.couponCode ?? null,
  );
  const [discount, setDiscount] = useState(initialDraft?.discountApplied ?? 0);
  const [artworkFinal, setArtworkFinal] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const storageKey = `atlas.newRequestWizard:${redirectBasePath}`;

  // Restore in-progress input that would otherwise be lost across a locale
  // switch (which remounts this page under the new /[locale] segment).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as PersistedWizardState;
      if ((saved.requestId ?? null) !== (requestId ?? null)) return;
      setStep(saved.step);
      setMainId(saved.mainId);
      setSubIds(saved.subIds ?? []);
      setItemId(saved.itemId);
      setProductNameEn(saved.productNameEn);
      setProductNameAr(saved.productNameAr);
      setBrand(saved.brand);
      setAttrs(saved.attrs);
      setCouponCode(saved.couponCode);
      setAppliedCoupon(saved.appliedCoupon);
      setDiscount(saved.discount);
      setArtworkFinal(saved.artworkFinal);
    } catch {
      // Corrupt/old-shape entry — ignore and start fresh.
    }
    // Restore once, right after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const data: PersistedWizardState = {
      requestId,
      step,
      mainId,
      subIds,
      itemId,
      productNameEn,
      productNameAr,
      brand,
      attrs,
      couponCode,
      appliedCoupon,
      discount,
      artworkFinal,
    };
    window.sessionStorage.setItem(storageKey, JSON.stringify(data));
  }, [
    storageKey,
    requestId,
    step,
    mainId,
    subIds,
    itemId,
    productNameEn,
    productNameAr,
    brand,
    attrs,
    couponCode,
    appliedCoupon,
    discount,
    artworkFinal,
  ]);

  const attrFields = useMemo(
    () => parseAttrSchema(selectedItem?.productAttrSchema),
    [selectedItem],
  );

  const breakdown = useMemo(() => {
    if (!selectedItem) {
      return { subtotal: 0, discount: 0, vatAmount: 0, total: 0 };
    }
    const b = computePriceBreakdown({
      basePrice: selectedItem.basePrice,
      discount,
      vatRate: selectedItem.vatRate,
    });
    return {
      subtotal: Number(b.subtotal),
      discount: Number(b.discount),
      vatAmount: Number(b.vatAmount),
      total: Number(b.total),
    };
  }, [selectedItem, discount]);

  const mandatoryTotal = slots.filter((s) => s.mandatory).length;
  const mandatoryFilled = slots.filter(
    (s) => s.mandatory && Boolean(s.fileName),
  ).length;
  const canSubmit =
    artworkFinal &&
    mandatoryFilled >= mandatoryTotal &&
    productNameEn.trim().length >= 2 &&
    productNameAr.trim().length >= 2 &&
    Boolean(requestId) &&
    Boolean(selectedItem);

  function rebuildSlotsForItem(item: CatalogueServiceItem) {
    setSlots(buildSlots(item, null, t("step3.additional")));
  }

  async function selectServiceItem(item: CatalogueServiceItem) {
    setItemId(item.id);
    rebuildSlotsForItem(item);
    setExpandedChecks(true);
    startTransition(async () => {
      const result = await createOrSelectDraft({
        serviceItemId: item.id,
        resumeRequestId: requestId,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setRequestId(result.data.requestId);
      setRequestNo(result.data.requestNo);
      setDiscount(0);
      setAppliedCoupon(null);
      setCouponCode("");
    });
  }

  useEffect(() => {
    if (items.length === 1 && items[0].id !== itemId) {
      void selectServiceItem(items[0]);
    }
    // Only re-run when the resolved item list changes; selectServiceItem is
    // stable for this purpose and itemId is checked inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  function goStep2() {
    if (!selectedItem || !requestId) {
      toast.error(t("errors.SELECT_SERVICE"));
      return;
    }
    setStep(2);
  }

  function goStep3() {
    if (productNameEn.trim().length < 2 || productNameAr.trim().length < 2) {
      toast.error(t("errors.PRODUCT_NAME"));
      return;
    }
    for (const field of attrFields) {
      if (field.required && (attrs[field.key] === undefined || attrs[field.key] === "")) {
        toast.error(t("errors.ATTRS_REQUIRED"));
        return;
      }
    }
    startTransition(async () => {
      if (!requestId) return;
      const result = await saveDraftProductDetails({
        requestId,
        productNameEn,
        productNameAr,
        brand: brand || null,
        productAttrs: attrs,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setStep(3);
    });
  }

  function clientRejectFile(file: File, slot: UploadSlotState): string | null {
    const accepted = slot.acceptedMimeTypes;
    if (!accepted.includes(file.type)) {
      const uploaded = file.name.includes(".")
        ? `.${file.name.split(".").pop()?.toLowerCase()}`
        : file.type || "unknown";
      const acceptedLabel = accepted
        .map((m) => {
          if (m === "application/pdf") return "PDF";
          if (m === "image/png") return "PNG";
          if (m === "image/jpeg") return "JPG";
          return m;
        })
        .join(", ");
      return t("errors.mimeRejected", {
        accepted: acceptedLabel,
        uploaded,
      });
    }
    if (file.size > slot.maxSizeMb * 1024 * 1024) {
      return t("errors.FILE_TOO_LARGE");
    }
    return null;
  }

  async function onUpload(slotIndex: number, file: File) {
    if (!requestId) return;
    const slot = slots[slotIndex];
    if (!slot) return;

    const clientError = clientRejectFile(file, slot);
    if (clientError) {
      toast.error(clientError);
      return;
    }

    setSlots((prev) =>
      prev.map((s, i) => (i === slotIndex ? { ...s, progress: 10 } : s)),
    );

    const fd = new FormData();
    fd.set("requestId", requestId);
    if (slot.requiredDocumentId) {
      fd.set("requiredDocumentId", slot.requiredDocumentId);
    }
    fd.set("label", slot.label);
    fd.set("file", file);

    const result = await uploadRequestDocument(fd);
    if (!result.ok) {
      setSlots((prev) =>
        prev.map((s, i) => (i === slotIndex ? { ...s, progress: undefined } : s)),
      );
      if (result.error === "MIME_REJECTED") {
        toast.error(
          t("errors.mimeRejected", {
            accepted: result.meta?.accepted ?? "PDF, PNG, JPG",
            uploaded: result.meta?.uploadedExt ?? "",
          }),
        );
      } else {
        toast.error(t(`errors.${result.error}` as never));
      }
      return;
    }

    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIndex
          ? {
              ...s,
              progress: 100,
              documentId: result.data.documentId,
              fileName: result.data.fileName,
              mimeType: result.data.mimeType,
              previewUrl: result.data.previewUrl,
            }
          : s,
      ),
    );
  }

  async function onDropFiles(slotIndex: number, fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || !requestId) return;
    const baseSlot = slots[slotIndex];
    if (!baseSlot) return;

    if (baseSlot.requiredDocumentId) {
      await onUpload(slotIndex, files[0]!);
      return;
    }

    let workingIndex = slotIndex;
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!;
      if (i > 0) {
        workingIndex = -1;
        setSlots((prev) => {
          const next = [
            ...prev,
            {
              requiredDocumentId: null,
              label: t("step3.additional"),
              mandatory: false,
              acceptedMimeTypes: [
                "application/pdf",
                "image/png",
                "image/jpeg",
              ],
              maxSizeMb: 50,
            } satisfies UploadSlotState,
          ];
          workingIndex = next.length - 1;
          return next;
        });
        await Promise.resolve();
        if (workingIndex < 0) continue;
      }
      await onUpload(workingIndex, file);
    }
  }

  async function onRemoveSlot(slotIndex: number) {
    const slot = slots[slotIndex];
    if (!slot?.documentId || !requestId) {
      setSlots((prev) =>
        prev.map((s, i) =>
          i === slotIndex
            ? {
                ...s,
                documentId: undefined,
                fileName: undefined,
                mimeType: undefined,
                previewUrl: undefined,
                progress: undefined,
              }
            : s,
        ),
      );
      return;
    }
    const result = await removeRequestDocument({
      requestId,
      documentId: slot.documentId,
    });
    if (!result.ok) {
      toast.error(t(`errors.${result.error}` as never));
      return;
    }
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIndex
          ? {
              ...s,
              documentId: undefined,
              fileName: undefined,
              mimeType: undefined,
              previewUrl: undefined,
              progress: undefined,
            }
          : s,
      ),
    );
  }

  function onApplyCoupon() {
    if (!requestId || !couponCode.trim()) return;
    startTransition(async () => {
      const result = await applyCouponToDraft({
        requestId,
        code: couponCode,
      });
      if (!result.ok) {
        toast.error(
          result.error === "EXPIRED"
            ? t("coupon.EXPIRED", {
                date: formatExpiredOn(result.meta?.expiredOn),
              })
            : t(`coupon.${result.error}` as never),
        );
        return;
      }
      setAppliedCoupon(result.data.couponCode);
      setDiscount(result.data.discount);
      toast.success(t("coupon.applied"));
    });
  }

  function onRemoveCoupon() {
    if (!requestId) return;
    startTransition(async () => {
      const result = await removeCouponFromDraft({ requestId });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setAppliedCoupon(null);
      setCouponCode("");
      setDiscount(0);
    });
  }

  function onSubmit() {
    if (!canSubmit || !requestId) return;
    startTransition(async () => {
      const result = await submitRequest({
        requestId,
        idempotencyKey,
        artworkIsFinal: true,
        productNameEn,
        productNameAr,
        brand: brand || null,
        productAttrs: attrs,
        couponCode: appliedCoupon,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      toast.success(t("submitted", { number: result.data.requestNo }));
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(storageKey);
      }
      if (onBehalf) {
        await endRequestOnBehalf();
      }
      router.push(`/${locale}${redirectBasePath}/${result.data.requestId}`);
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {[1, 2, 3, 4].map((n) => (
            <li
              key={n}
              className={cn(
                "rounded-full border px-3 py-1",
                step === n
                  ? "border-atlas-green bg-atlas-green-tint text-atlas-green-600"
                  : "border-line text-ink-500",
              )}
            >
              {t(`steps.${n}` as never)}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">{t("step1.title")}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {catalogue.mains.map((main) => (
                <button
                  key={main.id}
                  type="button"
                  onClick={() => {
                    setMainId(main.id);
                    setSubIds([]);
                    setItemId(null);
                  }}
                  className={cn(
                    "rounded-lg border p-4 text-start transition-colors duration-150 ease-out",
                    mainId === main.id
                      ? "border-atlas-green bg-atlas-green-tint"
                      : "border-line bg-surface hover:bg-surface-alt",
                  )}
                >
                  <div className="mb-2 flex size-10 items-center justify-center rounded-md border border-line bg-surface text-atlas-green">
                    {main.code === "COSMETICS" ? (
                      <Sparkles className="size-5" />
                    ) : (
                      <Pill className="size-5" />
                    )}
                  </div>
                  <p className="font-semibold text-ink-900">
                    {locale === "ar" ? main.nameAr : main.nameEn}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    {locale === "ar" ? main.descAr : main.descEn}
                  </p>
                </button>
              ))}
            </div>

            {mainId ? (
              <div className="flex flex-wrap gap-2">
                {subs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => {
                      setSubIds((prev) =>
                        prev.includes(sub.id)
                          ? prev.filter((id) => id !== sub.id)
                          : [...prev, sub.id],
                      );
                      setItemId(null);
                    }}
                    className={cn(
                      "rounded-md border px-3 py-2 text-sm font-medium",
                      subIds.includes(sub.id)
                        ? "border-atlas-green bg-atlas-green-tint text-atlas-green-600"
                        : "border-line text-ink-800",
                    )}
                  >
                    {locale === "ar" ? sub.nameAr : sub.nameEn}
                  </button>
                ))}
              </div>
            ) : null}

            {subIds.length > 0 ? (
              <ul className="space-y-2">
                {items.map((item) => {
                  const vat = item.basePrice * item.vatRate;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void selectServiceItem(item)}
                        className={cn(
                          "w-full rounded-lg border p-4 text-start transition-colors duration-150 ease-out",
                          itemId === item.id
                            ? "border-atlas-green bg-atlas-green-tint"
                            : "border-line bg-surface hover:bg-surface-alt",
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-ink-900">
                              {locale === "ar" ? item.nameAr : item.nameEn}
                            </p>
                            <p className="mt-1 text-xs text-ink-500">
                              {locale === "ar" ? item.descAr : item.descEn}
                            </p>
                          </div>
                          <div className="text-end">
                            <MoneyValue amount={item.basePrice} />
                            <p className="text-xs text-ink-500">
                              {t("step1.vatLine", {
                                vat: new Intl.NumberFormat(
                                  locale === "ar" ? "ar-SA" : "en-GB",
                                  { style: "currency", currency: "SAR" },
                                ).format(vat),
                              })}
                            </p>
                            <p className="text-xs text-ink-500">
                              {t("step1.slaLine", { hours: item.slaHours })}
                            </p>
                            <p className="text-xs text-ink-500">
                              {t("step1.docsLine", {
                                count: item.requiredDocumentCount,
                              })}
                            </p>
                          </div>
                        </div>
                      </button>
                      {itemId === item.id ? (
                        <div className="mt-2 rounded-md border border-line bg-surface-alt p-3">
                          <button
                            type="button"
                            className="text-sm font-semibold text-atlas-green-600"
                            onClick={() => setExpandedChecks((v) => !v)}
                          >
                            {t("step1.whatWeCheck")}
                          </button>
                          {expandedChecks ? (
                            <ul className="mt-2 space-y-1 text-sm text-ink-800">
                              {item.checkSets.map((set) => (
                                <li key={set.code}>
                                  · {locale === "ar" ? set.titleAr : set.titleEn}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <Button type="button" disabled={!itemId || pending} onClick={goStep2}>
              {t("continue")}
            </Button>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">{t("step2.title")}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("fields.productNameAr")}</Label>
                <Input
                  value={productNameAr}
                  onChange={(e) => setProductNameAr(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.productNameEn")}</Label>
                <Input
                  value={productNameEn}
                  onChange={(e) => setProductNameEn(e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("fields.brand")}</Label>
                <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
            </div>
            <div className="space-y-4">
              {attrFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>
                    {locale === "ar" ? field.titleAr : field.titleEn}
                  </Label>
                  <p className="text-xs text-ink-500">
                    {locale === "ar" ? field.helpAr : field.helpEn}
                  </p>
                  {field.type === "boolean" ? (
                    <Select
                      value={
                        attrs[field.key] === true
                          ? "true"
                          : attrs[field.key] === false
                            ? "false"
                            : ""
                      }
                      onValueChange={(v) =>
                        setAttrs((a) => ({ ...a, [field.key]: v === "true" }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("fields.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">{t("fields.yes")}</SelectItem>
                        <SelectItem value="false">{t("fields.no")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select
                      value={String(attrs[field.key] ?? "")}
                      onValueChange={(v) =>
                        setAttrs((a) => ({ ...a, [field.key]: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("fields.select")} />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.enum ?? []).map((opt) => (
                          <SelectItem key={opt} value={opt}>
                            {t(`enums.${opt}` as never)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                {t("back")}
              </Button>
              <Button type="button" disabled={pending} onClick={goStep3}>
                {t("continue")}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">{t("step3.title")}</h2>
            <p className="text-sm text-ink-500">
              {t("step3.counter", {
                filled: mandatoryFilled,
                total: mandatoryTotal,
              })}
            </p>
            <ul className="space-y-3">
              {slots.map((slot, index) => (
                <li
                  key={`${slot.requiredDocumentId ?? "extra"}-${index}`}
                  className="rounded-lg border border-line bg-surface p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">
                        {slot.requiredDocumentId
                          ? locale === "ar"
                            ? selectedItem?.requiredDocuments.find(
                                (d) => d.id === slot.requiredDocumentId,
                              )?.nameAr ?? slot.label
                            : selectedItem?.requiredDocuments.find(
                                (d) => d.id === slot.requiredDocumentId,
                              )?.nameEn ?? slot.label
                          : t("step3.additional")}
                        {slot.mandatory ? (
                          <span className="ms-2 text-state-bad">*</span>
                        ) : (
                          <span className="ms-2 text-xs text-ink-500">
                            ({t("step3.optional")})
                          </span>
                        )}
                      </p>
                    </div>
                    {slot.fileName ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => void onRemoveSlot(index)}
                        aria-label={t("step3.remove")}
                      >
                        <X className="size-4" />
                      </Button>
                    ) : null}
                  </div>
                  {slot.fileName ? (
                    <div className="flex items-center gap-3">
                      {slot.previewUrl && slot.mimeType?.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={slot.previewUrl}
                          alt=""
                          className="size-14 rounded-md border border-line object-cover"
                        />
                      ) : slot.previewUrl && slot.mimeType === "application/pdf" ? (
                        <object
                          data={slot.previewUrl}
                          type="application/pdf"
                          className="size-14 overflow-hidden rounded-md border border-line bg-surface-alt"
                          aria-label={slot.fileName}
                        />
                      ) : (
                        <div className="flex size-14 items-center justify-center rounded-md border border-line bg-surface-alt text-xs font-data">
                          PDF
                        </div>
                      )}
                      <p className="truncate text-sm text-ink-800" dir="ltr">
                        {slot.fileName}
                      </p>
                    </div>
                  ) : (
                    <label
                      className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line bg-surface-alt px-4 py-6 text-center"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void onDropFiles(index, e.dataTransfer.files);
                      }}
                    >
                      <Upload className="mb-2 size-5 text-atlas-green" />
                      <span className="text-sm text-ink-800">
                        {t("step3.drop")}
                      </span>
                      <input
                        type="file"
                        className="sr-only"
                        multiple={!slot.requiredDocumentId}
                        accept={slot.acceptedMimeTypes.join(",")}
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            void onDropFiles(index, e.target.files);
                          }
                          e.target.value = "";
                        }}
                      />
                      {typeof slot.progress === "number" ? (
                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line">
                          <div
                            className="h-full bg-atlas-green transition-[width] duration-150 ease-out"
                            style={{ width: `${slot.progress}%` }}
                          />
                        </div>
                      ) : null}
                    </label>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(2)}>
                {t("back")}
              </Button>
              <Button
                type="button"
                disabled={mandatoryFilled < mandatoryTotal}
                onClick={() => setStep(4)}
              >
                {t("continue")}
              </Button>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink-900">{t("step4.title")}</h2>
            <div className="rounded-lg border border-line bg-surface-alt p-4 text-sm text-ink-800">
              <p>
                <span className="text-ink-500">{t("summary.service")}: </span>
                {selectedItem
                  ? locale === "ar"
                    ? selectedItem.nameAr
                    : selectedItem.nameEn
                  : "—"}
              </p>
              <p>
                <span className="text-ink-500">{t("summary.product")}: </span>
                {locale === "ar" ? productNameAr : productNameEn}
              </p>
              <p>
                <span className="text-ink-500">{t("summary.docs")}: </span>
                {slots.filter((s) => s.fileName).length}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1 space-y-2">
                <Label>{t("coupon.label")}</Label>
                <Input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  disabled={Boolean(appliedCoupon)}
                  dir="ltr"
                  className="font-data"
                />
              </div>
              {appliedCoupon ? (
                <Button type="button" variant="outline" onClick={onRemoveCoupon}>
                  {t("coupon.remove")}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={onApplyCoupon}>
                  {t("coupon.apply")}
                </Button>
              )}
            </div>

            <label className="flex items-start gap-3 rounded-md border border-line bg-surface p-3 text-sm">
              <Checkbox
                checked={artworkFinal}
                onCheckedChange={(v) => setArtworkFinal(Boolean(v))}
              />
              <span>{t("step4.finalArtwork")}</span>
            </label>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(3)}>
                {t("back")}
              </Button>
              <Button
                type="button"
                disabled={!canSubmit || pending}
                onClick={onSubmit}
              >
                {t("step4.submit")}
              </Button>
            </div>
          </section>
        ) : null}
      </div>

      <aside className="h-fit w-full shrink-0 rounded-lg border border-line bg-surface p-4 shadow-elevation lg:sticky lg:top-20 lg:w-80">
        <h3 className="mb-3 text-sm font-semibold text-ink-900">
          {t("summary.title")}
        </h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{t("summary.category")}</dt>
            <dd className="text-end text-ink-800">
              {selectedMain
                ? locale === "ar"
                  ? selectedMain.nameAr
                  : selectedMain.nameEn
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">{t("summary.service")}</dt>
            <dd className="text-end text-ink-800">
              {selectedItem
                ? locale === "ar"
                  ? selectedItem.nameAr
                  : selectedItem.nameEn
                : "—"}
            </dd>
          </div>
          {requestNo ? (
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">{t("summary.draft")}</dt>
              <dd className="font-data text-end" dir="ltr">
                {requestNo}
              </dd>
            </div>
          ) : null}
          <div className="border-t border-line pt-2">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">{t("summary.subtotal")}</dt>
              <dd>
                <MoneyValue amount={breakdown.subtotal} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">{t("summary.discount")}</dt>
              <dd>
                <MoneyValue amount={breakdown.discount} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">{t("summary.vat")}</dt>
              <dd>
                <MoneyValue amount={breakdown.vatAmount} />
              </dd>
            </div>
            <div className="mt-1 flex justify-between gap-3 font-semibold">
              <dt className="text-ink-900">{t("summary.total")}</dt>
              <dd>
                <MoneyValue amount={breakdown.total} />
              </dd>
            </div>
          </div>
        </dl>
      </aside>
    </div>
  );
}

function formatExpiredOn(isoDate?: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function buildSlots(
  item: CatalogueServiceItem | null,
  draft: DraftRequestView | null,
  additionalLabel: string,
): UploadSlotState[] {
  if (!item) return [];
  const mapped: UploadSlotState[] = item.requiredDocuments.map((doc) => {
    const existing = draft?.documents.find(
      (d) => d.requiredDocumentId === doc.id,
    );
    return {
      requiredDocumentId: doc.id,
      label: doc.nameEn,
      mandatory: doc.mandatory,
      acceptedMimeTypes: doc.acceptedMimeTypes,
      maxSizeMb: doc.maxSizeMb,
      documentId: existing?.id,
      fileName: existing?.currentVersion?.fileName,
      mimeType: existing?.currentVersion?.mimeType,
      previewUrl: existing?.currentVersion
        ? `/api/storage/${existing.currentVersion.storageKey
            .split("/")
            .map(encodeURIComponent)
            .join("/")}`
        : undefined,
    };
  });

  const extras =
    draft?.documents.filter((d) => !d.requiredDocumentId) ?? [];
  if (extras.length === 0) {
    mapped.push({
      requiredDocumentId: null,
      label: additionalLabel,
      mandatory: false,
      acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
      maxSizeMb: 50,
    });
  } else {
    for (const existing of extras) {
      mapped.push({
        requiredDocumentId: null,
        label: additionalLabel,
        mandatory: false,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        maxSizeMb: 50,
        documentId: existing.id,
        fileName: existing.currentVersion?.fileName,
        mimeType: existing.currentVersion?.mimeType,
        previewUrl: existing.currentVersion
          ? `/api/storage/${existing.currentVersion.storageKey
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`
          : undefined,
      });
    }
    mapped.push({
      requiredDocumentId: null,
      label: additionalLabel,
      mandatory: false,
      acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
      maxSizeMb: 50,
    });
  }

  return mapped;
}
