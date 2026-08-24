"use client";

import { MoneyValue } from "@/components/atlas/money-value";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
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
import { STATE_TONE_CLASS } from "@/lib/request-state";
import { cn } from "@/lib/utils";
import {
  deleteServiceItem,
  removeRequiredDocumentTemplate,
  toggleServiceItemActive,
  updateServiceItem,
  uploadRequiredDocumentTemplate,
} from "@/server/admin/actions";
import type { AdminCatalogueItem, AdminCategoryTreeNode } from "@/server/admin/queries";
import { Loader2, Upload, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

type EvaluatorOption = { id: string; fullNameEn: string; fullNameAr: string };

type Props = {
  rows: AdminCatalogueItem[];
  categoryTree: AdminCategoryTreeNode[];
  evaluators: EvaluatorOption[];
};

export function AdminCatalogueTable({ rows, categoryTree, evaluators }: Props) {
  const t = useTranslations("adminOps.catalogue");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminCatalogueItem | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (item) =>
        item.code.toLowerCase().includes(q) ||
        item.nameEn.toLowerCase().includes(q) ||
        item.nameAr.includes(q),
    );
  }, [rows, query]);

  function handleToggle(item: AdminCatalogueItem) {
    setPendingId(item.id);
    startTransition(async () => {
      const result = await toggleServiceItemActive({
        id: item.id,
        active: !item.active,
      });
      setPendingId(null);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("success"));
      router.refresh();
    });
  }

  function handleDelete(item: AdminCatalogueItem) {
    if (!window.confirm(t("delete.confirm"))) return;
    setPendingId(item.id);
    startTransition(async () => {
      const result = await deleteServiceItem({ id: item.id });
      setPendingId(null);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      toast.success(t("delete.success"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tCommon("search")}
        className="max-w-xs"
      />

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface-alt px-6 py-10 text-center text-sm text-ink-500">
          {t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <thead className="bg-surface-alt text-start">
              <tr className="border-b border-line">
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.code")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.name")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.price")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.sla")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.status")}
                </th>
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {t("columns.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                >
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {item.code}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink-900">
                      {locale === "ar" ? item.nameAr : item.nameEn}
                    </p>
                    <p className="text-xs text-ink-500">
                      {locale === "ar"
                        ? item.subCategoryNameAr
                        : item.subCategoryNameEn}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <MoneyValue amount={item.basePrice} />
                  </td>
                  <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                    {item.slaHours}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                        STATE_TONE_CLASS[item.active ? "ok" : "neutral"],
                      )}
                    >
                      {item.active ? t("active") : t("inactive")}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing(item)}
                      >
                        {t("edit.button")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === item.id}
                        onClick={() => handleToggle(item)}
                      >
                        {pendingId === item.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : null}
                        {t("toggle")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === item.id}
                        onClick={() => handleDelete(item)}
                      >
                        {t("delete.button")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditServiceDialog
        key={editing?.id ?? "none"}
        item={editing}
        categoryTree={categoryTree}
        evaluators={evaluators}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function EditServiceDialog({
  item,
  categoryTree,
  evaluators,
  onClose,
  onSaved,
}: {
  categoryTree: AdminCategoryTreeNode[];
  evaluators: EvaluatorOption[];
  item: AdminCatalogueItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("adminOps.catalogue");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [mainId, setMainId] = useState(item?.mainCategoryId ?? "");
  const [subId, setSubId] = useState(item?.subCategoryId ?? "");
  const [evaluatorId, setEvaluatorId] = useState(item?.defaultEvaluatorId ?? "");

  const selectedMain = categoryTree.find((m) => m.id === mainId) ?? null;
  const subCategories = selectedMain?.subCategories ?? [];

  if (!item) return null;

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("edit.dialogTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (!subId) return;
            startTransition(async () => {
              const result = await updateServiceItem({
                id: item.id,
                subCategoryId: subId,
                code: String(fd.get("code") ?? ""),
                nameEn: String(fd.get("nameEn") ?? ""),
                nameAr: String(fd.get("nameAr") ?? ""),
                descEn: String(fd.get("descEn") ?? ""),
                descAr: String(fd.get("descAr") ?? ""),
                basePrice: String(fd.get("basePrice") ?? ""),
                vatRate: String(fd.get("vatRate") ?? ""),
                slaHours: Number(fd.get("slaHours")),
                resubmissionPricePct: String(fd.get("resubmissionPricePct") ?? ""),
                freeResubmissions: Number(fd.get("freeResubmissions")),
                maxResubmissions: Number(fd.get("maxResubmissions")),
                sortOrder: Number(fd.get("sortOrder")),
                requiresInspection: fd.get("requiresInspection") === "on",
                requiresLabTesting: fd.get("requiresLabTesting") === "on",
                requiresFactoryAudit: fd.get("requiresFactoryAudit") === "on",
                defaultEvaluatorId: evaluatorId || null,
              });
              if (!result.ok) {
                toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
                return;
              }
              toast.success(t("edit.success"));
              onSaved();
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>{t("edit.mainCategory")}</Label>
              <Select
                value={mainId}
                onValueChange={(v) => {
                  setMainId(v);
                  setSubId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("edit.selectMain")} />
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
            <div>
              <Label>{t("edit.subCategory")}</Label>
              <Select value={subId} onValueChange={setSubId} disabled={!mainId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("edit.selectSub")} />
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
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-code">{t("edit.code")}</Label>
              <Input
                id="edit-code"
                name="code"
                dir="ltr"
                className="font-data"
                defaultValue={item.code}
              />
            </div>
            <div>
              <Label htmlFor="edit-sortOrder">{t("edit.sortOrder")}</Label>
              <Input
                id="edit-sortOrder"
                name="sortOrder"
                type="number"
                min="0"
                dir="ltr"
                defaultValue={item.sortOrder}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-nameEn">{t("edit.nameEn")}</Label>
              <Input id="edit-nameEn" name="nameEn" defaultValue={item.nameEn} />
            </div>
            <div>
              <Label htmlFor="edit-nameAr">{t("edit.nameAr")}</Label>
              <Input
                id="edit-nameAr"
                name="nameAr"
                dir="rtl"
                defaultValue={item.nameAr}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="edit-descEn">{t("edit.descEn")}</Label>
            <Textarea
              id="edit-descEn"
              name="descEn"
              defaultValue={item.descEn}
            />
          </div>
          <div>
            <Label htmlFor="edit-descAr">{t("edit.descAr")}</Label>
            <Textarea
              id="edit-descAr"
              name="descAr"
              dir="rtl"
              defaultValue={item.descAr}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="edit-basePrice">{t("edit.basePrice")}</Label>
              <Input
                id="edit-basePrice"
                name="basePrice"
                type="number"
                step="0.01"
                min="0"
                dir="ltr"
                defaultValue={item.basePrice}
              />
            </div>
            <div>
              <Label htmlFor="edit-vatRate">{t("edit.vatRate")}</Label>
              <Input
                id="edit-vatRate"
                name="vatRate"
                type="number"
                step="0.01"
                min="0"
                max="1"
                dir="ltr"
                defaultValue={item.vatRate}
              />
            </div>
            <div>
              <Label htmlFor="edit-slaHours">{t("edit.slaHours")}</Label>
              <Input
                id="edit-slaHours"
                name="slaHours"
                type="number"
                min="1"
                dir="ltr"
                defaultValue={item.slaHours}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="edit-resubmissionPricePct">
                {t("edit.resubmissionPricePct")}
              </Label>
              <Input
                id="edit-resubmissionPricePct"
                name="resubmissionPricePct"
                type="number"
                step="0.01"
                min="0"
                max="1"
                dir="ltr"
                defaultValue={item.resubmissionPricePct}
              />
            </div>
            <div>
              <Label htmlFor="edit-freeResubmissions">
                {t("edit.freeResubmissions")}
              </Label>
              <Input
                id="edit-freeResubmissions"
                name="freeResubmissions"
                type="number"
                min="0"
                dir="ltr"
                defaultValue={item.freeResubmissions}
              />
            </div>
            <div>
              <Label htmlFor="edit-maxResubmissions">
                {t("edit.maxResubmissions")}
              </Label>
              <Input
                id="edit-maxResubmissions"
                name="maxResubmissions"
                type="number"
                min="0"
                dir="ltr"
                defaultValue={item.maxResubmissions}
              />
            </div>
          </div>

          <div>
            <Label>{t("edit.evaluationActivities")}</Label>
            <div className="mt-1 grid gap-2 rounded-md border border-line p-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <Checkbox
                  name="requiresInspection"
                  defaultChecked={item.requiresInspection}
                />
                {t("edit.requiresInspection")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <Checkbox
                  name="requiresLabTesting"
                  defaultChecked={item.requiresLabTesting}
                />
                {t("edit.requiresLabTesting")}
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-800">
                <Checkbox
                  name="requiresFactoryAudit"
                  defaultChecked={item.requiresFactoryAudit}
                />
                {t("edit.requiresFactoryAudit")}
              </label>
            </div>
          </div>

          <div>
            <Label>{t("edit.defaultEvaluator")}</Label>
            <Select
              value={evaluatorId || "none"}
              onValueChange={(v) => setEvaluatorId(v === "none" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("edit.defaultEvaluatorPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {t("edit.defaultEvaluatorNone")}
                </SelectItem>
                {evaluators.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>
                    {locale === "ar" ? ev.fullNameAr : ev.fullNameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-ink-500">
              {t("edit.defaultEvaluatorHint")}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("edit.cancel")}
            </Button>
            <Button type="submit" disabled={pending || !subId}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("edit.save")}
            </Button>
          </div>
        </form>

        {item.requiredDocuments.length > 0 ? (
          <div className="space-y-2 border-t border-line pt-4">
            <Label>{t("edit.requiredDocuments")}</Label>
            <p className="text-xs text-ink-500">
              {t("edit.requiredDocumentsHint")}
            </p>
            <ul className="space-y-2">
              {item.requiredDocuments.map((doc) => (
                <RequiredDocumentTemplateRow key={doc.id} doc={doc} />
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RequiredDocumentTemplateRow({
  doc,
}: {
  doc: AdminCatalogueItem["requiredDocuments"][number];
}) {
  const t = useTranslations("adminOps.catalogue");
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [templateFileName, setTemplateFileName] = useState(doc.templateFileName);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handleUpload(file: File) {
    setPending(true);
    const fd = new FormData();
    fd.set("requiredDocumentId", doc.id);
    fd.set("file", file);
    void uploadRequiredDocumentTemplate(fd).then((result) => {
      setPending(false);
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
        return;
      }
      setTemplateFileName(result.data.fileName);
      toast.success(t("edit.templateUploaded"));
      router.refresh();
    });
  }

  function handleRemove() {
    setPending(true);
    void removeRequiredDocumentTemplate({ requiredDocumentId: doc.id }).then(
      (result) => {
        setPending(false);
        if (!result.ok) {
          toast.error(t(`errors.${result.error}` as "errors.SAVE_FAILED"));
          return;
        }
        setTemplateFileName(null);
        toast.success(t("edit.templateRemoved"));
        router.refresh();
      },
    );
  }

  // Slots whose form varies per product (SAB-001's risk assessment) hold a set
  // of templates rather than one file. Uploading a single template here would
  // be ignored by the client UI, so the controls are hidden and the set is
  // reported read-only — it is managed by prisma/install-document-templates.ts.
  if (doc.templateVariantCount > 0) {
    return (
      <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-ink-900">
            {locale === "ar" ? doc.nameAr : doc.nameEn}
            {doc.mandatory ? <span className="ms-2 text-state-bad">*</span> : null}
          </p>
          <p className="text-xs text-ink-500">
            {t("edit.templateVariants", { count: doc.templateVariantCount })}
          </p>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-ink-900">
          {locale === "ar" ? doc.nameAr : doc.nameEn}
          {doc.mandatory ? <span className="ms-2 text-state-bad">*</span> : null}
        </p>
        <p className="truncate text-xs text-ink-500" dir="ltr">
          {templateFileName ?? t("edit.noTemplate")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {templateFileName ? t("edit.replaceTemplate") : t("edit.uploadTemplate")}
        </Button>
        {templateFileName ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={pending}
            onClick={handleRemove}
            aria-label={t("edit.removeTemplate")}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
