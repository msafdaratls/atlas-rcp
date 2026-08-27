"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { parseAttrSchema, validateProductAttrs } from "@/lib/attr-schema";
import { AttrScalarInput } from "@/components/atlas/requests/attr-field-input";
import { DocumentTemplateLinks } from "@/components/atlas/requests/document-template-links";
import { computeOrderBreakdown } from "@/lib/pricing";
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
  DraftRequestItemView,
  DraftRequestView,
} from "@/server/requests/queries";
import { createCredential } from "@/server/company/credentials";
import type { PlatformCredentialSummary } from "@/server/company/credentials";

type UploadSlotState = {
  requiredDocumentId: string | null;
  label: string;
  mandatory: boolean;
  acceptedMimeTypes: string[];
  maxSizeMb: number;
  helpEn?: string | null;
  helpAr?: string | null;
  templateUrl?: string | null;
  templateFileName?: string | null;
  templateVariantAttrKey?: string | null;
  templateVariants?: { variantKey: string; url: string; fileName: string }[];
  documentId?: string;
  fileName?: string;
  mimeType?: string;
  previewUrl?: string;
  progress?: number;
};

type ItemState = {
  requestItemId: string;
  serviceItemId: string;
  productNameEn: string;
  productNameAr: string;
  brand: string;
  attrs: Record<string, unknown>;
  platformCredentialId: string | null;
  slots: UploadSlotState[];
};

type PersistedItemState = {
  requestItemId: string;
  serviceItemId: string;
  productNameEn: string;
  productNameAr: string;
  brand: string;
  attrs: Record<string, unknown>;
  platformCredentialId: string | null;
};

type PersistedWizardState = {
  requestId: string | null;
  step: number;
  mainId: string | null;
  subIds: string[];
  cartIds: string[];
  items: PersistedItemState[];
  couponCode: string;
  appliedCoupon: string | null;
  discount: number;
  infoCorrect: boolean;
};

type Props = {
  catalogue: CataloguePayload;
  initialDraft: DraftRequestView | null;
  initialMainId?: string | null;
  /** Where to send the user after submit (before the request id). */
  redirectBasePath?: string;
  /** True when an admin is creating on a client's behalf — clears the pin. */
  onBehalf?: boolean;
  /** The acting org's stored GHAD/SABER/FASAH logins, for services that need one. */
  credentials?: PlatformCredentialSummary[];
  /** Links a brand-new draft to a standing Engagement (SABER Account Management, etc). */
  engagementId?: string | null;
};

function buildSlots(
  item: CatalogueServiceItem,
  draftItem: DraftRequestItemView | undefined,
  additionalLabel: string,
): UploadSlotState[] {
  const mapped: UploadSlotState[] = item.requiredDocuments.map((doc) => {
    const existing = draftItem?.documents.find(
      (d) => d.requiredDocumentId === doc.id,
    );
    return {
      requiredDocumentId: doc.id,
      label: doc.nameEn,
      mandatory: doc.mandatory,
      acceptedMimeTypes: doc.acceptedMimeTypes,
      maxSizeMb: doc.maxSizeMb,
      helpEn: doc.helpEn,
      helpAr: doc.helpAr,
      templateUrl: doc.templateUrl,
      templateFileName: doc.templateFileName,
      templateVariantAttrKey: doc.templateVariantAttrKey,
      templateVariants: doc.templateVariants,
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

  const extras = draftItem?.documents.filter((d) => !d.requiredDocumentId) ?? [];
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

function itemStateFromDraft(
  draftItem: DraftRequestItemView,
  catalogueItem: CatalogueServiceItem | undefined,
  additionalLabel: string,
): ItemState {
  return {
    requestItemId: draftItem.id,
    serviceItemId: draftItem.serviceItemId,
    productNameEn: draftItem.productNameEn,
    productNameAr: draftItem.productNameAr,
    brand: draftItem.brand ?? "",
    attrs: draftItem.productAttrs,
    platformCredentialId: draftItem.platformCredentialId,
    slots: catalogueItem ? buildSlots(catalogueItem, draftItem, additionalLabel) : [],
  };
}

export function NewRequestWizard({
  catalogue,
  initialDraft,
  initialMainId,
  redirectBasePath = "/client/requests",
  onBehalf = false,
  credentials: initialCredentials = [],
  engagementId = null,
}: Props) {
  const t = useTranslations("newRequest");
  const tEnums = useTranslations("newRequest.enums");
  const tCredentials = useTranslations("company.credentials");
  const locale = useLocale();
  const [credentials, setCredentials] = useState(initialCredentials);
  const [credentialDialogPlatform, setCredentialDialogPlatform] = useState<
    PlatformCredentialSummary["platform"] | null
  >(null);
  const [credentialLabel, setCredentialLabel] = useState("");
  const [credentialLoginIdentifier, setCredentialLoginIdentifier] =
    useState("");
  const [credentialSecret, setCredentialSecret] = useState("");
  const [credentialPending, setCredentialPending] = useState(false);
  const [credentialTargetItemId, setCredentialTargetItemId] = useState<
    string | null
  >(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const catalogueItemById = useMemo(
    () => new Map(catalogue.items.map((i) => [i.id, i])),
    [catalogue.items],
  );

  const initialMainAndSubs = useMemo(() => {
    if (!initialDraft || initialDraft.items.length === 0) return null;
    const first = catalogueItemById.get(initialDraft.items[0]!.serviceItemId);
    if (!first) return null;
    const sub = catalogue.subs.find((s) => s.id === first.subCategoryId);
    const subIds = Array.from(
      new Set(
        initialDraft.items
          .map((i) => catalogueItemById.get(i.serviceItemId)?.subCategoryId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    return { mainId: sub?.mainCategoryId ?? null, subIds };
    // Only computed once, from the initial draft passed in on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState(1);
  const [mainId, setMainId] = useState<string | null>(
    initialMainAndSubs?.mainId ?? initialMainId ?? null,
  );
  const [subIds, setSubIds] = useState<string[]>(
    initialMainAndSubs?.subIds ?? [],
  );
  const [cartIds, setCartIds] = useState<string[]>(
    initialDraft?.items.map((i) => i.serviceItemId) ?? [],
  );
  const [requestId, setRequestId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [requestNo, setRequestNo] = useState<string | null>(
    initialDraft?.requestNo ?? null,
  );
  const [items, setItems] = useState<ItemState[]>(
    () =>
      initialDraft?.items.map((di) =>
        itemStateFromDraft(
          di,
          catalogueItemById.get(di.serviceItemId),
          t("step3.additional"),
        ),
      ) ?? [],
  );

  const selectedMain = catalogue.mains.find((m) => m.id === mainId) ?? null;
  const subs = catalogue.subs.filter((s) => s.mainCategoryId === mainId);
  const browsableItems = useMemo(
    () => catalogue.items.filter((i) => subIds.includes(i.subCategoryId)),
    [catalogue.items, subIds],
  );

  // Deselecting a subcategory (or switching main categories) hides its items
  // from browsableItems, which would otherwise leave their ids orphaned in
  // cartIds — still counted in the summary/submission but with no control
  // left on screen to remove them.
  useEffect(() => {
    setCartIds((prev) =>
      prev.filter((id) => {
        const item = catalogueItemById.get(id);
        return item ? subIds.includes(item.subCategoryId) : false;
      }),
    );
  }, [subIds, catalogueItemById]);

  const [couponCode, setCouponCode] = useState(initialDraft?.couponCode ?? "");
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(
    initialDraft?.couponCode ?? null,
  );
  const [discount, setDiscount] = useState(initialDraft?.discountApplied ?? 0);
  const [infoCorrect, setInfoCorrect] = useState(false);
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
      setCartIds(saved.cartIds ?? []);
      setItems((prev) =>
        (saved.items ?? []).map((si) => {
          const catalogueItem = catalogueItemById.get(si.serviceItemId);
          const existing = prev.find((p) => p.requestItemId === si.requestItemId);
          return {
            requestItemId: si.requestItemId,
            serviceItemId: si.serviceItemId,
            productNameEn: si.productNameEn,
            productNameAr: si.productNameAr,
            brand: si.brand,
            attrs: si.attrs,
            platformCredentialId: si.platformCredentialId ?? null,
            slots:
              existing?.slots ??
              (catalogueItem
                ? buildSlots(catalogueItem, undefined, t("step3.additional"))
                : []),
          };
        }),
      );
      setCouponCode(saved.couponCode);
      setAppliedCoupon(saved.appliedCoupon);
      setDiscount(saved.discount);
      setInfoCorrect(saved.infoCorrect);
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
      cartIds,
      items: items.map((i) => ({
        requestItemId: i.requestItemId,
        serviceItemId: i.serviceItemId,
        productNameEn: i.productNameEn,
        productNameAr: i.productNameAr,
        brand: i.brand,
        attrs: i.attrs,
        platformCredentialId: i.platformCredentialId,
      })),
      couponCode,
      appliedCoupon,
      discount,
      infoCorrect,
    };
    window.sessionStorage.setItem(storageKey, JSON.stringify(data));
  }, [
    storageKey,
    requestId,
    step,
    mainId,
    subIds,
    cartIds,
    items,
    couponCode,
    appliedCoupon,
    discount,
    infoCorrect,
  ]);

  // On step 1 the server draft (`items`) hasn't been created/updated yet, so
  // the summary must reflect the live cart selection instead or it looks
  // stuck while the user is still picking service items.
  const summaryCatalogueItems = useMemo(() => {
    if (step === 1) {
      return cartIds
        .map((id) => catalogueItemById.get(id))
        .filter((i): i is CatalogueServiceItem => Boolean(i));
    }
    return items
      .map((i) => catalogueItemById.get(i.serviceItemId))
      .filter((i): i is CatalogueServiceItem => Boolean(i));
  }, [step, cartIds, items, catalogueItemById]);

  const breakdown = useMemo(() => {
    if (summaryCatalogueItems.length === 0) {
      return { subtotal: 0, discount: 0, vatAmount: 0, total: 0 };
    }
    const b = computeOrderBreakdown(
      summaryCatalogueItems.map((catalogueItem) => ({
        basePrice: catalogueItem.basePrice ?? 0,
        vatRate: catalogueItem.vatRate ?? 0.15,
      })),
      discount,
    );
    return {
      subtotal: Number(b.subtotal),
      discount: Number(b.discount),
      vatAmount: Number(b.vatAmount),
      total: Number(b.total),
    };
  }, [summaryCatalogueItems, discount]);

  const mandatoryTotal = items.reduce(
    (sum, i) => sum + i.slots.filter((s) => s.mandatory).length,
    0,
  );
  const mandatoryFilled = items.reduce(
    (sum, i) =>
      sum + i.slots.filter((s) => s.mandatory && Boolean(s.fileName)).length,
    0,
  );
  const canSubmit =
    infoCorrect &&
    items.length > 0 &&
    mandatoryFilled >= mandatoryTotal &&
    items.every((i) => i.productNameEn.trim().length >= 2) &&
    Boolean(requestId);

  function toggleCartItem(itemId: string) {
    setCartIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  }

  function goStep1Continue() {
    if (cartIds.length === 0) {
      toast.error(t("errors.SELECT_SERVICE"));
      return;
    }
    startTransition(async () => {
      const result = await createOrSelectDraft({
        serviceItemIds: cartIds,
        resumeRequestId: requestId,
        engagementId,
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
      setItems((prev) =>
        result.data.items.map((ri) => {
          const existing = prev.find((p) => p.requestItemId === ri.id);
          if (existing) return existing;
          const catalogueItem = catalogueItemById.get(ri.serviceItemId);
          return {
            requestItemId: ri.id,
            serviceItemId: ri.serviceItemId,
            productNameEn: "",
            productNameAr: "",
            brand: "",
            attrs: {},
            platformCredentialId: null,
            slots: catalogueItem
              ? buildSlots(catalogueItem, undefined, t("step3.additional"))
              : [],
          };
        }),
      );
      setStep(2);
    });
  }

  function updateItem(requestItemId: string, patch: Partial<ItemState>) {
    setItems((prev) =>
      prev.map((i) => (i.requestItemId === requestItemId ? { ...i, ...patch } : i)),
    );
  }

  function openCredentialDialog(
    requestItemId: string,
    platform: PlatformCredentialSummary["platform"],
  ) {
    setCredentialTargetItemId(requestItemId);
    setCredentialDialogPlatform(platform);
    setCredentialLabel("");
    setCredentialLoginIdentifier("");
    setCredentialSecret("");
  }

  function handleCreateCredential() {
    if (
      !credentialDialogPlatform ||
      !credentialTargetItemId ||
      !credentialLoginIdentifier.trim() ||
      !credentialSecret
    ) {
      toast.error(tCredentials("errors.VALIDATION"));
      return;
    }
    setCredentialPending(true);
    createCredential({
      platform: credentialDialogPlatform,
      label: credentialLabel.trim() || undefined,
      loginIdentifier: credentialLoginIdentifier.trim(),
      secret: credentialSecret,
    })
      .then((result) => {
        if (!result.ok) {
          toast.error(tCredentials(`errors.${result.error}` as never));
          return;
        }
        const created: PlatformCredentialSummary = {
          id: result.data.id,
          platform: credentialDialogPlatform,
          label: credentialLabel.trim() || null,
          loginIdentifier: credentialLoginIdentifier.trim(),
          active: true,
          createdAt: new Date(),
        };
        setCredentials((prev) => [created, ...prev]);
        updateItem(credentialTargetItemId, { platformCredentialId: created.id });
        toast.success(tCredentials("created"));
        setCredentialDialogPlatform(null);
        setCredentialTargetItemId(null);
      })
      .finally(() => setCredentialPending(false));
  }

  function goStep3() {
    for (const item of items) {
      if (item.productNameEn.trim().length < 2) {
        toast.error(t("errors.PRODUCT_NAME"));
        return;
      }
      const catalogueItem = catalogueItemById.get(item.serviceItemId);
      if (validateProductAttrs(catalogueItem?.productAttrSchema, item.attrs)) {
        toast.error(t("errors.ATTRS_REQUIRED"));
        return;
      }
      if (catalogueItem?.requiredCredentialPlatform && !item.platformCredentialId) {
        toast.error(t("errors.CREDENTIAL_REQUIRED"));
        return;
      }
    }
    startTransition(async () => {
      for (const item of items) {
        const result = await saveDraftProductDetails({
          requestItemId: item.requestItemId,
          productNameEn: item.productNameEn,
          productNameAr: item.productNameAr,
          brand: item.brand || null,
          productAttrs: item.attrs,
          platformCredentialId: item.platformCredentialId,
        });
        if (!result.ok) {
          toast.error(t(`errors.${result.error}` as never));
          return;
        }
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

  async function onUpload(requestItemId: string, slotIndex: number, file: File) {
    if (!requestId) return;
    const item = items.find((i) => i.requestItemId === requestItemId);
    const slot = item?.slots[slotIndex];
    if (!slot) return;

    const clientError = clientRejectFile(file, slot);
    if (clientError) {
      toast.error(clientError);
      return;
    }

    setItems((prev) =>
      prev.map((i) =>
        i.requestItemId === requestItemId
          ? {
              ...i,
              slots: i.slots.map((s, idx) =>
                idx === slotIndex ? { ...s, progress: 10 } : s,
              ),
            }
          : i,
      ),
    );

    const fd = new FormData();
    fd.set("requestId", requestId);
    fd.set("requestItemId", requestItemId);
    if (slot.requiredDocumentId) {
      fd.set("requiredDocumentId", slot.requiredDocumentId);
    }
    fd.set("label", slot.label);
    fd.set("file", file);

    const result = await uploadRequestDocument(fd);
    if (!result.ok) {
      setItems((prev) =>
        prev.map((i) =>
          i.requestItemId === requestItemId
            ? {
                ...i,
                slots: i.slots.map((s, idx) =>
                  idx === slotIndex ? { ...s, progress: undefined } : s,
                ),
              }
            : i,
        ),
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

    setItems((prev) =>
      prev.map((i) =>
        i.requestItemId === requestItemId
          ? {
              ...i,
              slots: i.slots.map((s, idx) =>
                idx === slotIndex
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
            }
          : i,
      ),
    );
  }

  async function onDropFiles(
    requestItemId: string,
    slotIndex: number,
    fileList: FileList | File[],
  ) {
    const files = Array.from(fileList);
    if (files.length === 0 || !requestId) return;
    const item = items.find((i) => i.requestItemId === requestItemId);
    const baseSlot = item?.slots[slotIndex];
    if (!baseSlot) return;

    if (baseSlot.requiredDocumentId) {
      await onUpload(requestItemId, slotIndex, files[0]!);
      return;
    }

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]!;
      let workingIndex = slotIndex;
      if (i > 0) {
        workingIndex = -1;
        setItems((prev) =>
          prev.map((it) => {
            if (it.requestItemId !== requestItemId) return it;
            const next = [
              ...it.slots,
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
            return { ...it, slots: next };
          }),
        );
        await Promise.resolve();
        if (workingIndex < 0) continue;
      }
      await onUpload(requestItemId, workingIndex, file);
    }
  }

  async function onRemoveSlot(requestItemId: string, slotIndex: number) {
    const item = items.find((i) => i.requestItemId === requestItemId);
    const slot = item?.slots[slotIndex];
    if (!slot?.documentId || !requestId) {
      setItems((prev) =>
        prev.map((i) =>
          i.requestItemId === requestItemId
            ? {
                ...i,
                slots: i.slots.map((s, idx) =>
                  idx === slotIndex
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
              }
            : i,
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
    setItems((prev) =>
      prev.map((i) =>
        i.requestItemId === requestItemId
          ? {
              ...i,
              slots: i.slots.map((s, idx) =>
                idx === slotIndex
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
            }
          : i,
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
          {[1, 2, 3, 4].map((n) => {
            const reachable = n <= step;
            return (
              <li key={n}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => reachable && setStep(n)}
                  className={cn(
                    "rounded-full border px-3 py-1",
                    step === n
                      ? "border-atlas-green bg-atlas-green-tint text-atlas-green-600"
                      : reachable
                        ? "border-line text-ink-500 hover:border-atlas-green-600 hover:text-atlas-green-600"
                        : "cursor-not-allowed border-line text-ink-300",
                  )}
                >
                  {t(`steps.${n}` as never)}
                </button>
              </li>
            );
          })}
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
                      // Single-select: these render as a tab bar (one
                      // highlighted pill), so the underlying state must
                      // behave like one too. A multi-select toggle here
                      // let two sub-categories show "selected" at once and
                      // left a stale service list on screen when switching
                      // into an empty sub-category.
                      setSubIds((prev) =>
                        prev.length === 1 && prev[0] === sub.id ? [] : [sub.id],
                      );
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

            {subIds.length > 0 && browsableItems.length === 0 ? (
              <p className="rounded-lg border border-line bg-surface-alt p-4 text-sm text-ink-500">
                {t("step1.noServices")}
              </p>
            ) : null}

            {subIds.length > 0 && browsableItems.length > 0 ? (
              <ul className="space-y-2">
                {browsableItems.map((item) => {
                  const vat = item.basePrice * item.vatRate;
                  const inCart = cartIds.includes(item.id);
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleCartItem(item.id)}
                        className={cn(
                          "w-full rounded-lg border p-4 text-start transition-colors duration-150 ease-out",
                          inCart
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
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <Button
              type="button"
              disabled={cartIds.length === 0 || pending}
              onClick={goStep1Continue}
            >
              {t("continue")}
            </Button>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-ink-900">{t("step2.title")}</h2>
            {items.map((item) => {
              const catalogueItem = catalogueItemById.get(item.serviceItemId);
              const attrFields = parseAttrSchema(catalogueItem?.productAttrSchema);
              return (
                <div
                  key={item.requestItemId}
                  className="space-y-4 rounded-lg border border-line bg-surface p-4"
                >
                  <p className="text-sm font-semibold text-ink-900">
                    {catalogueItem
                      ? locale === "ar"
                        ? catalogueItem.nameAr
                        : catalogueItem.nameEn
                      : ""}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        {t("fields.productNameAr")}
                        <span className="ms-2 text-xs text-ink-500">
                          ({t("step3.optional")})
                        </span>
                      </Label>
                      <Input
                        value={item.productNameAr}
                        onChange={(e) =>
                          updateItem(item.requestItemId, {
                            productNameAr: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>
                        {t("fields.productNameEn")}
                        <span className="ms-2 text-state-bad">*</span>
                      </Label>
                      <Input
                        value={item.productNameEn}
                        onChange={(e) =>
                          updateItem(item.requestItemId, {
                            productNameEn: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>
                        {t("fields.brand")}
                        <span className="ms-2 text-xs text-ink-500">
                          ({t("step3.optional")})
                        </span>
                      </Label>
                      <Input
                        value={item.brand}
                        onChange={(e) =>
                          updateItem(item.requestItemId, { brand: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    {attrFields.map((field) => (
                      <div key={field.key} className="space-y-2">
                        <Label>
                          {locale === "ar" ? field.titleAr : field.titleEn}
                          {field.required ? (
                            <span className="ms-2 text-state-bad">*</span>
                          ) : (
                            <span className="ms-2 text-xs text-ink-500">
                              ({t("step3.optional")})
                            </span>
                          )}
                        </Label>
                        <p className="text-xs text-ink-500">
                          {locale === "ar" ? field.helpAr : field.helpEn}
                        </p>
                        {field.type === "array" ? (
                          <div className="space-y-3">
                            {(Array.isArray(item.attrs[field.key])
                              ? (item.attrs[field.key] as Record<string, unknown>[])
                              : []
                            ).map((row, rowIndex) => (
                              <div
                                key={rowIndex}
                                className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3 sm:flex-row sm:items-start"
                              >
                                <div className="grid flex-1 gap-3 sm:grid-cols-2">
                                  {(field.items ?? []).map((subField) => (
                                    <div key={subField.key} className="space-y-1">
                                      <Label>
                                        {locale === "ar" ? subField.titleAr : subField.titleEn}
                                        {subField.required ? (
                                          <span className="ms-2 text-state-bad">*</span>
                                        ) : null}
                                      </Label>
                                      <AttrScalarInput
                                        field={subField}
                                        value={row[subField.key]}
                                        onChange={(v) => {
                                          const rows = Array.isArray(item.attrs[field.key])
                                            ? [...(item.attrs[field.key] as Record<string, unknown>[])]
                                            : [];
                                          rows[rowIndex] = { ...rows[rowIndex], [subField.key]: v };
                                          updateItem(item.requestItemId, {
                                            attrs: { ...item.attrs, [field.key]: rows },
                                          });
                                        }}
                                        selectPlaceholder={t("fields.select")}
                                        yesLabel={t("fields.yes")}
                                        noLabel={t("fields.no")}
                                        enumLabel={(opt) => t(`enums.${opt}` as never)}
                                      />
                                    </div>
                                  ))}
                                </div>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => {
                                    const rows = Array.isArray(item.attrs[field.key])
                                      ? (item.attrs[field.key] as Record<string, unknown>[])
                                      : [];
                                    updateItem(item.requestItemId, {
                                      attrs: {
                                        ...item.attrs,
                                        [field.key]: rows.filter((_, i) => i !== rowIndex),
                                      },
                                    });
                                  }}
                                  aria-label={t("fields.removeEntry")}
                                >
                                  <X className="size-4" />
                                </Button>
                              </div>
                            ))}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const rows = Array.isArray(item.attrs[field.key])
                                  ? (item.attrs[field.key] as Record<string, unknown>[])
                                  : [];
                                updateItem(item.requestItemId, {
                                  attrs: { ...item.attrs, [field.key]: [...rows, {}] },
                                });
                              }}
                            >
                              {t("fields.addEntry")}
                            </Button>
                          </div>
                        ) : (
                          <AttrScalarInput
                            field={field}
                            value={item.attrs[field.key]}
                            onChange={(v) =>
                              updateItem(item.requestItemId, {
                                attrs: { ...item.attrs, [field.key]: v },
                              })
                            }
                            selectPlaceholder={t("fields.select")}
                            yesLabel={t("fields.yes")}
                            noLabel={t("fields.no")}
                            enumLabel={(opt) => t(`enums.${opt}` as never)}
                          />
                        )}
                      </div>
                    ))}
                    {catalogueItem?.requiredCredentialPlatform ? (
                      <div className="space-y-2">
                        <Label>
                          {catalogueItem.requiredCredentialPlatform === "SABER"
                            ? t("fields.saberAccountLabel")
                            : t("fields.platformCredential", {
                                platform: catalogueItem.requiredCredentialPlatform,
                              })}
                          <span className="ms-2 text-state-bad">*</span>
                        </Label>
                        <Select
                          value={item.platformCredentialId ?? ""}
                          onValueChange={(v) =>
                            updateItem(item.requestItemId, {
                              platformCredentialId: v,
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("fields.select")} />
                          </SelectTrigger>
                          <SelectContent>
                            {credentials
                              .filter(
                                (c) =>
                                  c.platform ===
                                  catalogueItem.requiredCredentialPlatform,
                              )
                              .map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.label
                                    ? `${c.label} (${c.loginIdentifier})`
                                    : c.loginIdentifier}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {credentials.filter(
                          (c) =>
                            c.platform === catalogueItem.requiredCredentialPlatform,
                        ).length === 0 ? (
                          <p className="text-xs text-danger-500">
                            {t("fields.noCredentials", {
                              platform: catalogueItem.requiredCredentialPlatform,
                            })}
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            openCredentialDialog(
                              item.requestItemId,
                              catalogueItem.requiredCredentialPlatform as PlatformCredentialSummary["platform"],
                            )
                          }
                        >
                          {tCredentials("add")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
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
          <section className="space-y-6">
            <h2 className="text-lg font-semibold text-ink-900">{t("step3.title")}</h2>
            <p className="text-sm text-ink-500">
              {t("step3.counter", {
                filled: mandatoryFilled,
                total: mandatoryTotal,
              })}
            </p>
            {onBehalf ? (
              <div className="flex items-start gap-3 rounded-lg border border-atlas-green/30 bg-atlas-green/5 px-4 py-3">
                <span className="mt-0.5 text-lg" aria-hidden="true">
                  💬
                </span>
                <p className="text-sm text-ink-800">{t("step3.shareHint")}</p>
              </div>
            ) : null}
            {items.map((item) => {
              const catalogueItem = catalogueItemById.get(item.serviceItemId);
              // Product name disambiguates the groups: several products of the
              // same service repeat the same slots, and product-specific forms
              // (SAB-001's risk assessment) need one upload per product.
              const productName =
                (locale === "ar" ? item.productNameAr : item.productNameEn).trim() ||
                item.productNameEn.trim();
              return (
                <div key={item.requestItemId} className="space-y-3">
                  <p className="text-sm font-semibold text-ink-900">
                    {catalogueItem
                      ? locale === "ar"
                        ? catalogueItem.nameAr
                        : catalogueItem.nameEn
                      : ""}
                    {productName ? ` — ${productName}` : ""}
                  </p>
                  <ul className="space-y-3">
                    {item.slots.map((slot, index) => (
                      <li
                        key={`${slot.requiredDocumentId ?? "extra"}-${index}`}
                        className="rounded-lg border border-line bg-surface p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-ink-900">
                              {slot.requiredDocumentId
                                ? locale === "ar"
                                  ? catalogueItem?.requiredDocuments.find(
                                      (d) => d.id === slot.requiredDocumentId,
                                    )?.nameAr ?? slot.label
                                  : catalogueItem?.requiredDocuments.find(
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
                            {(locale === "ar" ? slot.helpAr : slot.helpEn) ? (
                              <p className="mt-0.5 text-xs text-ink-500">
                                {locale === "ar" ? slot.helpAr : slot.helpEn}
                              </p>
                            ) : null}
                            <DocumentTemplateLinks
                              templateUrl={slot.templateUrl}
                              templateFileName={slot.templateFileName}
                              templateVariantAttrKey={slot.templateVariantAttrKey}
                              templateVariants={slot.templateVariants}
                              productAttrs={item.attrs}
                              downloadLabel={t("step3.downloadTemplate")}
                              chooseLabel={t("step3.chooseTemplate")}
                              variantLabel={(key) => tEnums(key as never)}
                            />
                          </div>
                          {slot.fileName ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                void onRemoveSlot(item.requestItemId, index)
                              }
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
                            ) : slot.previewUrl &&
                              slot.mimeType === "application/pdf" ? (
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
                              void onDropFiles(
                                item.requestItemId,
                                index,
                                e.dataTransfer.files,
                              );
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
                                  void onDropFiles(
                                    item.requestItemId,
                                    index,
                                    e.target.files,
                                  );
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
                </div>
              );
            })}
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
              {items.map((item) => {
                const catalogueItem = catalogueItemById.get(item.serviceItemId);
                const docsFilled = item.slots.filter((s) => s.fileName).length;
                return (
                  <div
                    key={item.requestItemId}
                    className="border-b border-line py-2 last:border-0"
                  >
                    <p>
                      <span className="text-ink-500">{t("summary.service")}: </span>
                      {catalogueItem
                        ? locale === "ar"
                          ? catalogueItem.nameAr
                          : catalogueItem.nameEn
                        : "—"}
                    </p>
                    <p>
                      <span className="text-ink-500">{t("summary.product")}: </span>
                      {locale === "ar" ? item.productNameAr : item.productNameEn}
                    </p>
                    <p>
                      <span className="text-ink-500">{t("summary.docs")}: </span>
                      {docsFilled}
                    </p>
                  </div>
                );
              })}
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
                checked={infoCorrect}
                onCheckedChange={(v) => setInfoCorrect(Boolean(v))}
              />
              <span>{t("step4.declaration")}</span>
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
              {summaryCatalogueItems.length > 0
                ? summaryCatalogueItems
                    .map((catalogueItem) =>
                      locale === "ar" ? catalogueItem.nameAr : catalogueItem.nameEn,
                    )
                    .filter(Boolean)
                    .join(", ")
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

      <Dialog
        open={credentialDialogPlatform !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCredentialDialogPlatform(null);
            setCredentialTargetItemId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tCredentials("add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tCredentials("label")}</Label>
              <Input
                value={credentialLabel}
                onChange={(e) => setCredentialLabel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tCredentials("loginIdentifier")}</Label>
              <Input
                value={credentialLoginIdentifier}
                onChange={(e) => setCredentialLoginIdentifier(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tCredentials("secret")}</Label>
              <Input
                type="password"
                value={credentialSecret}
                onChange={(e) => setCredentialSecret(e.target.value)}
                autoComplete="new-password"
              />
              <p className="text-xs text-ink-500">
                {tCredentials("secretHelp")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCredentialDialogPlatform(null);
                setCredentialTargetItemId(null);
              }}
            >
              {tCredentials("cancel")}
            </Button>
            <Button
              type="button"
              disabled={credentialPending}
              onClick={handleCreateCredential}
            >
              {tCredentials("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatExpiredOn(isoDate?: string): string {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}
