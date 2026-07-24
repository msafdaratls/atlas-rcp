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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { createServiceItem } from "@/server/admin/actions";
import type { AdminCategoryTreeNode } from "@/server/admin/queries";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

const MIME_OPTIONS = [
  { value: "application/pdf", labelKey: "pdf" },
  { value: "image/png", labelKey: "png" },
  { value: "image/jpeg", labelKey: "jpeg" },
] as const;

type AttrType = "string" | "number" | "boolean";

type AttrRow = {
  key: string;
  type: AttrType;
  titleEn: string;
  titleAr: string;
  required: boolean;
};

type CheckSetRow = {
  code: string;
  titleEn: string;
  titleAr: string;
};

type DocumentRow = {
  code: string;
  nameEn: string;
  nameAr: string;
  mandatory: boolean;
  acceptedMimeTypes: string[];
  maxSizeMb: string;
};

function emptyDocument(): DocumentRow {
  return {
    code: "",
    nameEn: "",
    nameAr: "",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf"],
    maxSizeMb: "",
  };
}

function emptyAttr(): AttrRow {
  return {
    key: "",
    type: "string",
    titleEn: "",
    titleAr: "",
    required: false,
  };
}

function emptyCheckSet(): CheckSetRow {
  return { code: "", titleEn: "", titleAr: "" };
}

type Props = { categoryTree: AdminCategoryTreeNode[] };

export function CreateServiceWizard({ categoryTree }: Props) {
  const t = useTranslations("adminOps.catalogue.create");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);

  const [mainId, setMainId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descAr, setDescAr] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [slaHours, setSlaHours] = useState("");
  const [vatRate, setVatRate] = useState("0.15");
  const [resubmissionPricePct, setResubmissionPricePct] = useState("0.5");
  const [freeResubmissions, setFreeResubmissions] = useState("0");
  const [maxResubmissions, setMaxResubmissions] = useState("3");
  const [active, setActive] = useState(true);

  const [attributes, setAttributes] = useState<AttrRow[]>([]);
  const [checkSets, setCheckSets] = useState<CheckSetRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  const selectedMain = categoryTree.find((m) => m.id === mainId) ?? null;
  const subCategories = selectedMain?.subCategories ?? [];
  const selectedSub = subCategories.find((s) => s.id === subId) ?? null;

  const canGoStep2 = Boolean(mainId && subId);
  const canGoStep3 =
    code.trim().length > 0 &&
    nameEn.trim().length >= 2 &&
    nameAr.trim().length >= 2 &&
    Number(basePrice) >= 0 &&
    basePrice.trim().length > 0 &&
    Number(slaHours) > 0 &&
    slaHours.trim().length > 0;

  const attributesValid = attributes.every(
    (attr) =>
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(attr.key.trim()) &&
      attr.titleEn.trim().length > 0 &&
      attr.titleAr.trim().length > 0,
  );
  const checkSetsValid = checkSets.every(
    (row) =>
      row.code.trim().length > 0 &&
      row.titleEn.trim().length > 0 &&
      row.titleAr.trim().length > 0,
  );
  const documentsValid = documents.every(
    (doc) =>
      doc.code.trim().length > 0 &&
      doc.nameEn.trim().length > 0 &&
      doc.nameAr.trim().length > 0 &&
      doc.acceptedMimeTypes.length > 0,
  );

  function resetForm() {
    setStep(1);
    setMainId(null);
    setSubId(null);
    setCode("");
    setNameEn("");
    setNameAr("");
    setDescEn("");
    setDescAr("");
    setBasePrice("");
    setSlaHours("");
    setVatRate("0.15");
    setResubmissionPricePct("0.5");
    setFreeResubmissions("0");
    setMaxResubmissions("3");
    setActive(true);
    setAttributes([]);
    setCheckSets([]);
    setDocuments([]);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function updateAttr(index: number, patch: Partial<AttrRow>) {
    setAttributes((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function updateCheckSet(index: number, patch: Partial<CheckSetRow>) {
    setCheckSets((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function updateDocument(index: number, patch: Partial<DocumentRow>) {
    setDocuments((prev) =>
      prev.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)),
    );
  }

  function toggleMimeType(index: number, mime: string, checked: boolean) {
    setDocuments((prev) =>
      prev.map((doc, i) => {
        if (i !== index) return doc;
        const next = checked
          ? [...doc.acceptedMimeTypes, mime]
          : doc.acceptedMimeTypes.filter((m) => m !== mime);
        return { ...doc, acceptedMimeTypes: next };
      }),
    );
  }

  function onSubmit() {
    if (!subId) return;
    startTransition(async () => {
      const result = await createServiceItem({
        subCategoryId: subId,
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        descEn: descEn.trim() || undefined,
        descAr: descAr.trim() || undefined,
        basePrice: basePrice.trim(),
        slaHours: Number(slaHours),
        vatRate: vatRate.trim() || undefined,
        resubmissionPricePct: resubmissionPricePct.trim() || undefined,
        freeResubmissions: freeResubmissions.trim()
          ? Number(freeResubmissions)
          : undefined,
        maxResubmissions: maxResubmissions.trim()
          ? Number(maxResubmissions)
          : undefined,
        active,
        productAttributes: attributes.map((attr) => ({
          key: attr.key.trim(),
          type: attr.type,
          titleEn: attr.titleEn.trim(),
          titleAr: attr.titleAr.trim(),
          required: attr.required,
        })),
        checkSets: checkSets.map((row) => ({
          code: row.code.trim(),
          titleEn: row.titleEn.trim(),
          titleAr: row.titleAr.trim(),
        })),
        requiredDocuments: documents.map((doc) => ({
          code: doc.code.trim(),
          nameEn: doc.nameEn.trim(),
          nameAr: doc.nameAr.trim(),
          mandatory: doc.mandatory,
          acceptedMimeTypes: doc.acceptedMimeTypes,
          maxSizeMb: doc.maxSizeMb.trim() ? Number(doc.maxSizeMb) : undefined,
        })),
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
        </DialogHeader>

        <ol className="flex flex-wrap gap-2 text-xs font-semibold">
          {[1, 2, 3, 4, 5].map((n) => (
            <li
              key={n}
              className={cn(
                "rounded-full border px-3 py-1",
                step === n
                  ? "border-atlas-green bg-atlas-green-tint text-atlas-green-600"
                  : "border-line text-ink-500",
              )}
            >
              {t(`steps.${n}` as "steps.1")}
            </li>
          ))}
        </ol>

        <div className="max-h-[60vh] overflow-y-auto pe-1">
          {step === 1 ? (
            <section className="space-y-4">
              <div className="space-y-2">
                <Label>{t("step1.mainCategory")}</Label>
                <Select
                  value={mainId ?? ""}
                  onValueChange={(v) => {
                    setMainId(v);
                    setSubId(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("step1.selectMain")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryTree.map((main) => (
                      <SelectItem key={main.id} value={main.id}>
                        {locale === "ar" ? main.nameAr : main.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("step1.subCategory")}</Label>
                <Select
                  value={subId ?? ""}
                  onValueChange={setSubId}
                  disabled={!mainId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("step1.selectSub")} />
                  </SelectTrigger>
                  <SelectContent>
                    {subCategories.map((sub) => (
                      <SelectItem key={sub.id} value={sub.id}>
                        {locale === "ar" ? sub.nameAr : sub.nameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("step2.code")}</Label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    dir="ltr"
                    className="font-data"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.slaHours")}</Label>
                  <Input
                    type="number"
                    min={1}
                    value={slaHours}
                    onChange={(e) => setSlaHours(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.nameEn")}</Label>
                  <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.nameAr")}</Label>
                  <Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t("step2.descEn")}</Label>
                  <Textarea
                    value={descEn}
                    onChange={(e) => setDescEn(e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t("step2.descAr")}</Label>
                  <Textarea
                    value={descAr}
                    onChange={(e) => setDescAr(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.basePrice")}</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.vatRate")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step="0.01"
                    value={vatRate}
                    onChange={(e) => setVatRate(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.resubmissionPricePct")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step="0.01"
                    value={resubmissionPricePct}
                    onChange={(e) => setResubmissionPricePct(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.freeResubmissions")}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={freeResubmissions}
                    onChange={(e) => setFreeResubmissions(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("step2.maxResubmissions")}</Label>
                  <Input
                    type="number"
                    min={0}
                    value={maxResubmissions}
                    onChange={(e) => setMaxResubmissions(e.target.value)}
                    dir="ltr"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={active}
                  onCheckedChange={(v) => setActive(Boolean(v))}
                />
                {t("step2.active")}
              </label>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-6">
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">
                    {t("step3.attributesTitle")}
                  </h3>
                  <p className="text-xs text-ink-500">{t("step3.attributesHint")}</p>
                </div>
                {attributes.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line bg-surface-alt px-4 py-4 text-center text-sm text-ink-500">
                    {t("step3.attributesEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {attributes.map((attr, index) => (
                      <li
                        key={index}
                        className="space-y-3 rounded-lg border border-line bg-surface p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-ink-500">
                            #{index + 1}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setAttributes((prev) =>
                                prev.filter((_, i) => i !== index),
                              )
                            }
                            aria-label={t("step3.removeAttr")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label>{t("step3.attrKey")}</Label>
                            <Input
                              value={attr.key}
                              onChange={(e) =>
                                updateAttr(index, { key: e.target.value })
                              }
                              dir="ltr"
                              className="font-data"
                              placeholder={t("step3.attrKeyPlaceholder")}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("step3.attrType")}</Label>
                            <Select
                              value={attr.type}
                              onValueChange={(v) =>
                                updateAttr(index, { type: v as AttrType })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="string">
                                  {t("step3.attrTypes.string")}
                                </SelectItem>
                                <SelectItem value="number">
                                  {t("step3.attrTypes.number")}
                                </SelectItem>
                                <SelectItem value="boolean">
                                  {t("step3.attrTypes.boolean")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label>{t("step3.attrTitleEn")}</Label>
                            <Input
                              value={attr.titleEn}
                              onChange={(e) =>
                                updateAttr(index, { titleEn: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("step3.attrTitleAr")}</Label>
                            <Input
                              value={attr.titleAr}
                              onChange={(e) =>
                                updateAttr(index, { titleAr: e.target.value })
                              }
                            />
                          </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={attr.required}
                            onCheckedChange={(v) =>
                              updateAttr(index, { required: Boolean(v) })
                            }
                          />
                          {t("step3.attrRequired")}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setAttributes((prev) => [...prev, emptyAttr()])
                  }
                >
                  <Plus className="size-4" />
                  {t("step3.addAttr")}
                </Button>
              </div>

              <div className="space-y-3 border-t border-line pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">
                    {t("step3.checkSetsTitle")}
                  </h3>
                  <p className="text-xs text-ink-500">{t("step3.checkSetsHint")}</p>
                </div>
                {checkSets.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line bg-surface-alt px-4 py-4 text-center text-sm text-ink-500">
                    {t("step3.checkSetsEmpty")}
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {checkSets.map((row, index) => (
                      <li
                        key={index}
                        className="space-y-3 rounded-lg border border-line bg-surface p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-ink-500">
                            #{index + 1}
                          </span>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() =>
                              setCheckSets((prev) =>
                                prev.filter((_, i) => i !== index),
                              )
                            }
                            aria-label={t("step3.removeCheckSet")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label>{t("step3.checkCode")}</Label>
                            <Input
                              value={row.code}
                              onChange={(e) =>
                                updateCheckSet(index, { code: e.target.value })
                              }
                              dir="ltr"
                              className="font-data"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("step3.checkTitleEn")}</Label>
                            <Input
                              value={row.titleEn}
                              onChange={(e) =>
                                updateCheckSet(index, {
                                  titleEn: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>{t("step3.checkTitleAr")}</Label>
                            <Input
                              value={row.titleAr}
                              onChange={(e) =>
                                updateCheckSet(index, {
                                  titleAr: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setCheckSets((prev) => [...prev, emptyCheckSet()])
                  }
                >
                  <Plus className="size-4" />
                  {t("step3.addCheckSet")}
                </Button>
              </div>
            </section>
          ) : null}

          {step === 4 ? (
            <section className="space-y-4">
              {documents.length === 0 ? (
                <p className="rounded-md border border-dashed border-line bg-surface-alt px-4 py-6 text-center text-sm text-ink-500">
                  {t("step4.empty")}
                </p>
              ) : (
                <ul className="space-y-3">
                  {documents.map((doc, index) => (
                    <li
                      key={index}
                      className="space-y-3 rounded-lg border border-line bg-surface p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink-500">
                          #{index + 1}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setDocuments((prev) =>
                              prev.filter((_, i) => i !== index),
                            )
                          }
                          aria-label={t("step4.remove")}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label>{t("step4.code")}</Label>
                          <Input
                            value={doc.code}
                            onChange={(e) =>
                              updateDocument(index, { code: e.target.value })
                            }
                            dir="ltr"
                            className="font-data"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>{t("step4.maxSizeMb")}</Label>
                          <Input
                            type="number"
                            min={1}
                            placeholder="50"
                            value={doc.maxSizeMb}
                            onChange={(e) =>
                              updateDocument(index, {
                                maxSizeMb: e.target.value,
                              })
                            }
                            dir="ltr"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>{t("step4.nameEn")}</Label>
                          <Input
                            value={doc.nameEn}
                            onChange={(e) =>
                              updateDocument(index, { nameEn: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>{t("step4.nameAr")}</Label>
                          <Input
                            value={doc.nameAr}
                            onChange={(e) =>
                              updateDocument(index, { nameAr: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>{t("step4.acceptedMimeTypes")}</Label>
                        <div className="flex flex-wrap gap-3">
                          {MIME_OPTIONS.map((opt) => (
                            <label
                              key={opt.value}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={doc.acceptedMimeTypes.includes(
                                  opt.value,
                                )}
                                onCheckedChange={(v) =>
                                  toggleMimeType(
                                    index,
                                    opt.value,
                                    Boolean(v),
                                  )
                                }
                              />
                              {t(`step4.mimeTypes.${opt.labelKey}`)}
                            </label>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={doc.mandatory}
                          onCheckedChange={(v) =>
                            updateDocument(index, {
                              mandatory: Boolean(v),
                            })
                          }
                        />
                        {t("step4.mandatory")}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setDocuments((prev) => [...prev, emptyDocument()])
                }
              >
                <Plus className="size-4" />
                {t("step4.add")}
              </Button>
            </section>
          ) : null}

          {step === 5 ? (
            <section className="space-y-3">
              <dl className="space-y-2 rounded-lg border border-line bg-surface-alt p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.category")}</dt>
                  <dd className="text-end text-ink-800">
                    {selectedMain
                      ? `${locale === "ar" ? selectedMain.nameAr : selectedMain.nameEn} · ${
                          selectedSub
                            ? locale === "ar"
                              ? selectedSub.nameAr
                              : selectedSub.nameEn
                            : ""
                        }`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.service")}</dt>
                  <dd className="text-end text-ink-800">
                    {locale === "ar" ? nameAr : nameEn} ({code})
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.price")}</dt>
                  <dd className="text-end text-ink-800" dir="ltr">
                    {basePrice || "0"} SAR
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.sla")}</dt>
                  <dd className="text-end text-ink-800" dir="ltr">
                    {slaHours || "0"}h
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.attributes")}</dt>
                  <dd className="text-end text-ink-800">{attributes.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.checkSets")}</dt>
                  <dd className="text-end text-ink-800">{checkSets.length}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">{t("step5.documents")}</dt>
                  <dd className="text-end text-ink-800">{documents.length}</dd>
                </div>
              </dl>
            </section>
          ) : null}
        </div>

        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={step === 1}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
          >
            {t("back")}
          </Button>
          {step < 5 ? (
            <Button
              type="button"
              disabled={
                (step === 1 && !canGoStep2) ||
                (step === 2 && !canGoStep3) ||
                (step === 3 && (!attributesValid || !checkSetsValid)) ||
                (step === 4 && !documentsValid)
              }
              onClick={() => setStep((s) => Math.min(5, s + 1))}
            >
              {t("continue")}
            </Button>
          ) : (
            <Button type="button" disabled={pending} onClick={onSubmit}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("submit")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
