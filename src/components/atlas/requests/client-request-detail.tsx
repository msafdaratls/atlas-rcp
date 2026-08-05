"use client";

import { DocumentCard, type DocumentVersionView } from "@/components/atlas/document-card";
import { MoneyValue } from "@/components/atlas/money-value";
import { SlaMeter } from "@/components/atlas/sla-meter";
import { StatusRail } from "@/components/atlas/status-rail";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { parseAttrSchema } from "@/lib/attr-schema";
import {
  addClientRequestComment,
  discardDraftRequest,
  resubmitReturnedRequest,
  saveDraftProductDetails,
  uploadRequestDocument,
} from "@/server/requests/actions";
import type { ClientRequestDetail } from "@/server/requests/queries";
import { format } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import {
  FilePlus2,
  Loader2,
  Receipt,
  RotateCcw,
  Send,
  Trash2,
  Upload,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type Props = { data: ClientRequestDetail };

function storageUrl(key: string) {
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function openStorage(key: string) {
  window.open(storageUrl(key), "_blank", "noopener,noreferrer");
}

export function ClientRequestDetailPanel({ data }: Props) {
  const t = useTranslations("requestDetail");
  const tReasons = useTranslations("returnReasons");
  const tFault = useTranslations("statusRail");
  const tFields = useTranslations("newRequest.fields");
  const tEnums = useTranslations("newRequest.enums");
  const locale = useLocale();
  const dateLocale = locale === "ar" ? arSA : enGB;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const [messageBody, setMessageBody] = useState("");
  const [messagePending, startMessageTransition] = useTransition();

  const [productNameEn, setProductNameEn] = useState(data.productNameEn);
  const [productNameAr, setProductNameAr] = useState(data.productNameAr);
  const [brand, setBrand] = useState(data.brand ?? "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>(data.productAttrs);
  const [savingProduct, setSavingProduct] = useState(false);

  const attrFields = useMemo(
    () => parseAttrSchema(data.productAttrSchema),
    [data.productAttrSchema],
  );

  const totalOpenAmount = useMemo(
    () => data.invoices.reduce((sum, inv) => sum + inv.openAmount, 0),
    [data.invoices],
  );

  const onDownload = (version: DocumentVersionView & { storageKey?: string }) => {
    const key =
      data.documents
        .flatMap((d) => d.versions)
        .find((v) => v.id === version.id)?.storageKey ?? null;
    if (key) openStorage(key);
  };

  const onPreview = onDownload;

  const handleDiscardDraft = () => {
    setDiscarding(true);
    startTransition(async () => {
      const result = await discardDraftRequest({ requestId: data.id });
      setDiscarding(false);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setDiscardOpen(false);
      toast.success(t("draft.discarded"));
      router.push(`/${locale}/client/requests`);
    });
  };

  const handleSaveProductDetails = () => {
    if (productNameEn.trim().length < 2 || productNameAr.trim().length < 2) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    setSavingProduct(true);
    startTransition(async () => {
      const result = await saveDraftProductDetails({
        requestId: data.id,
        productNameEn,
        productNameAr,
        brand: brand || null,
        productAttrs: attrs,
      });
      setSavingProduct(false);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("edit.saved"));
      router.refresh();
    });
  };

  const handleResubmit = () => {
    startTransition(async () => {
      const result = await resubmitReturnedRequest({
        requestId: data.id,
        note: note.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("resubmitSuccess"));
      router.refresh();
    });
  };

  const canMessage = data.state !== "DRAFT" && data.state !== "CANCELLED";

  const handleSendMessage = () => {
    const body = messageBody.trim();
    if (!body) return;
    startMessageTransition(async () => {
      const result = await addClientRequestComment({
        requestId: data.id,
        body,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("messageSent"));
      setMessageBody("");
      router.refresh();
    });
  };

  const handleUpload = async (requiredDocumentId: string, label: string) => {
    const input = fileRefs.current[requiredDocumentId];
    const file = input?.files?.[0];
    if (!file) return;
    setUploadingSlot(requiredDocumentId);
    try {
      const fd = new FormData();
      fd.set("requestId", data.id);
      fd.set("requiredDocumentId", requiredDocumentId);
      fd.set("label", label);
      fd.set("file", file);
      const result = await uploadRequestDocument(fd);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("uploadSuccess"));
      router.refresh();
    } finally {
      setUploadingSlot(null);
      if (input) input.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <div>
          <p className="text-xs text-ink-500">{t("service")}</p>
          <p className="font-semibold text-ink-900">
            {locale === "ar" ? data.serviceNameAr : data.serviceNameEn}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {t("submission", { n: data.submissionNo })}
            {" · "}
            <MoneyValue amount={data.priceCharged} />
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {t("submittedAt", {
              date: format(
                new Date(data.submittedAt ?? data.createdAt),
                "PPp",
                { locale: dateLocale },
              ),
            })}
          </p>
        </div>
        <SlaMeter
          dueAt={data.slaDueAt}
          state={data.state}
          startedAt={data.submittedAt}
        />
      </div>

      {data.state === "DRAFT" ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-alt p-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">
              {t("draft.title")}
            </h2>
            <p className="mt-1 text-sm text-ink-500">{t("draft.body")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(true)}
            >
              <Trash2 className="size-4" />
              {t("draft.discard")}
            </Button>
            <Button asChild>
              <Link href={`/${locale}/client/requests/new?resume=${data.id}`}>
                <FilePlus2 className="size-4" />
                {t("draft.continue")}
              </Link>
            </Button>
          </div>
        </section>
      ) : null}

      {data.invoices.length > 0 ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-4">
          <div>
            <h2 className="text-sm font-semibold text-state-warn">
              {t("payment.title")}
            </h2>
            <p className="mt-1 text-sm text-ink-800">
              {t("payment.body", { count: data.invoices.length })}
              {" · "}
              <MoneyValue amount={totalOpenAmount} />
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={`/${locale}/client/statement?invoice=${data.invoices[0]?.id}`}>
              <Receipt className="size-4" />
              {t("payment.viewStatement")}
            </Link>
          </Button>
        </section>
      ) : null}

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("draft.discardConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("draft.discardConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDiscardOpen(false)}
            >
              {t("draft.discardCancel")}
            </Button>
            <Button
              type="button"
              onClick={handleDiscardDraft}
              disabled={discarding}
            >
              {discarding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("draft.discardConfirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {data.state === "RETURNED_TO_CLIENT" && data.returnInfo ? (
        <section
          className="rounded-lg border border-state-warn/40 bg-[color-mix(in_srgb,var(--state-warn)_8%,white)] p-4"
          aria-label={t("returnTitle")}
        >
          <h2 className="text-sm font-semibold text-state-warn">
            {t("returnTitle")}
          </h2>
          <p className="mt-2 text-sm text-ink-800">
            {data.returnInfo.reasonCodes.length > 0
              ? data.returnInfo.reasonCodes.map((code) => tReasons(code)).join(", ")
              : t("returnFallback")}
            {data.returnInfo.faultAttribution
              ? ` · ${tFault(data.returnInfo.faultAttribution)}`
              : ""}
          </p>
          {data.returnInfo.note ? (
            <p className="mt-1 text-sm text-ink-500">{data.returnInfo.note}</p>
          ) : null}

          {data.canResubmit ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-3 rounded-md border border-line bg-surface p-3">
                <h3 className="text-sm font-semibold text-ink-900">
                  {t("edit.title")}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{tFields("productNameAr")}</Label>
                    <Input
                      value={productNameAr}
                      onChange={(e) => setProductNameAr(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>{tFields("productNameEn")}</Label>
                    <Input
                      value={productNameEn}
                      onChange={(e) => setProductNameEn(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label>{tFields("brand")}</Label>
                    <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
                  </div>
                </div>
                {attrFields.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {attrFields.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <Label>
                          {locale === "ar" ? field.titleAr : field.titleEn}
                        </Label>
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
                              <SelectValue placeholder={tFields("select")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">{tFields("yes")}</SelectItem>
                              <SelectItem value="false">{tFields("no")}</SelectItem>
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
                              <SelectValue placeholder={tFields("select")} />
                            </SelectTrigger>
                            <SelectContent>
                              {(field.enum ?? []).map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {tEnums(opt as never)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleSaveProductDetails}
                  disabled={savingProduct}
                >
                  {savingProduct ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {t("edit.save")}
                </Button>
              </div>
              <div className="space-y-3">
                {data.requiredDocuments.map((slot) => {
                  const existing = data.documents.find(
                    (d) => d.requiredDocumentId === slot.id,
                  );
                  return (
                    <div
                      key={slot.id}
                      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-medium text-ink-900">
                          {locale === "ar" ? slot.nameAr : slot.nameEn}
                          {slot.mandatory ? " *" : ""}
                        </p>
                        <p className="text-xs text-ink-500">
                          {existing?.currentVersion
                            ? existing.currentVersion.fileName
                            : t("noFileYet")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={(el) => {
                            fileRefs.current[slot.id] = el;
                          }}
                          type="file"
                          className="hidden"
                          accept={slot.acceptedMimeTypes.join(",")}
                          onChange={() =>
                            void handleUpload(
                              slot.id,
                              locale === "ar" ? slot.nameAr : slot.nameEn,
                            )
                          }
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={uploadingSlot === slot.id}
                          onClick={() => fileRefs.current[slot.id]?.click()}
                        >
                          {uploadingSlot === slot.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Upload className="size-4" />
                          )}
                          {t("replaceFile")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <Label htmlFor="resubmit-note">{t("noteLabel")}</Label>
                <Input
                  id="resubmit-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("notePlaceholder")}
                  className="mt-1"
                />
              </div>
              <Button
                type="button"
                onClick={handleResubmit}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RotateCcw className="size-4" />
                )}
                {t("resubmit")}
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-500">{t("maxResubmissions")}</p>
          )}
        </section>
      ) : null}

      <StatusRail
        events={data.events.map((e) => ({
          id: e.id,
          fromState: e.fromState,
          toState: e.toState,
          actorName: locale === "ar" ? e.actorNameAr : e.actorNameEn,
          actorRole: e.actorRole,
          note: e.note,
          reasonCodes: e.reasonCodes,
          faultAttribution: e.faultAttribution,
          createdAt: e.createdAt,
        }))}
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("documents")}</h2>
        {data.documents.filter((d) => d.currentVersion).length === 0 ? (
          <p className="text-sm text-ink-500">{t("documentsEmpty")}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.documents
              .filter((d) => d.currentVersion)
              .map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={{
                    id: doc.id,
                    label: doc.label,
                    currentVersion: doc.currentVersion
                      ? {
                          id: doc.currentVersion.id,
                          version: doc.currentVersion.version,
                          fileName: doc.currentVersion.fileName,
                          mimeType: doc.currentVersion.mimeType,
                          sizeBytes: doc.currentVersion.sizeBytes,
                          uploadedByName:
                            locale === "ar"
                              ? doc.currentVersion.uploadedByNameAr
                              : doc.currentVersion.uploadedByNameEn,
                          uploadedAt: doc.currentVersion.uploadedAt,
                        }
                      : null,
                    versions: doc.versions.map((v) => ({
                      id: v.id,
                      version: v.version,
                      fileName: v.fileName,
                      mimeType: v.mimeType,
                      sizeBytes: v.sizeBytes,
                      uploadedByName:
                        locale === "ar"
                          ? v.uploadedByNameAr
                          : v.uploadedByNameEn,
                      uploadedAt: v.uploadedAt,
                    })),
                  }}
                  onDownload={onDownload}
                  onPreview={onPreview}
                />
              ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">{t("comments")}</h2>
        {data.comments.length === 0 ? (
          <p className="text-sm text-ink-500">{t("commentsEmpty")}</p>
        ) : (
          <ul className="space-y-3">
            {data.comments.map((c) => (
              <li
                key={c.id}
                className="rounded-lg border border-line bg-surface p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {locale === "ar" ? c.authorNameAr : c.authorNameEn}
                  </p>
                  <time
                    className="font-data text-xs text-ink-500"
                    dir="ltr"
                  >
                    {c.createdAt.slice(0, 16).replace("T", " ")}
                  </time>
                </div>
                <p className="mt-2 text-sm text-ink-800">
                  {locale === "ar"
                    ? (c.bodyAr ?? c.bodyEn)
                    : (c.bodyEn ?? c.bodyAr)}
                </p>
              </li>
            ))}
          </ul>
        )}
        {canMessage ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
            <Label htmlFor="client-message">{t("sendMessage")}</Label>
            <Textarea
              id="client-message"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              placeholder={t("messagePlaceholder")}
              rows={3}
            />
            <Button
              type="button"
              size="sm"
              disabled={messagePending || messageBody.trim().length === 0}
              onClick={handleSendMessage}
            >
              {messagePending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {t("sendMessage")}
            </Button>
          </div>
        ) : null}
      </section>

      {data.state === "REPORT_ISSUED" || data.state === "CLOSED" ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <a
              href={`/api/reports/${data.id}/pdf?locale=${locale}`}
              target="_blank"
              rel="noreferrer"
            >
              {t("downloadReport")}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={`/${locale}/verify/${data.requestNo}`} target="_blank" rel="noreferrer">
              {t("verify")}
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
