"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  createMainCategory,
  createSubCategory,
  deleteMainCategory,
  deleteSubCategory,
  updateMainCategory,
  updateSubCategory,
} from "@/server/admin/actions";
import type { AdminCategoryTreeNode } from "@/server/admin/queries";
import { Loader2 } from "lucide-react";

export function ManageCategoriesDialog({
  categoryTree,
}: {
  categoryTree: AdminCategoryTreeNode[];
}) {
  const t = useTranslations("adminOps.catalogue.categories");
  const tErr = useTranslations("adminOps.catalogue.errors");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Main category form
  const [mainCode, setMainCode] = useState("");
  const [mainNameEn, setMainNameEn] = useState("");
  const [mainNameAr, setMainNameAr] = useState("");

  // Subcategory form
  const [subParent, setSubParent] = useState("");
  const [subCode, setSubCode] = useState("");
  const [subNameEn, setSubNameEn] = useState("");
  const [subNameAr, setSubNameAr] = useState("");

  // Row-level edit state
  const [editingMainId, setEditingMainId] = useState<string | null>(null);
  const [editingSubId, setEditingSubId] = useState<string | null>(null);

  function name(node: { nameEn: string; nameAr: string }) {
    return locale === "ar" ? node.nameAr : node.nameEn;
  }

  function addMain() {
    startTransition(async () => {
      const result = await createMainCategory({
        code: mainCode.trim(),
        nameEn: mainNameEn.trim(),
        nameAr: mainNameAr.trim(),
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("mainAdded"));
      setMainCode("");
      setMainNameEn("");
      setMainNameAr("");
      router.refresh();
    });
  }

  function addSub() {
    if (!subParent) {
      toast.error(t("needMainFirst"));
      return;
    }
    startTransition(async () => {
      const result = await createSubCategory({
        mainCategoryId: subParent,
        code: subCode.trim(),
        nameEn: subNameEn.trim(),
        nameAr: subNameAr.trim(),
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("subAdded"));
      setSubCode("");
      setSubNameEn("");
      setSubNameAr("");
      router.refresh();
    });
  }

  function saveMain(id: string, fd: FormData) {
    startTransition(async () => {
      const result = await updateMainCategory({
        id,
        code: String(fd.get("code") ?? "").trim(),
        nameEn: String(fd.get("nameEn") ?? "").trim(),
        nameAr: String(fd.get("nameAr") ?? "").trim(),
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("mainUpdated"));
      setEditingMainId(null);
      router.refresh();
    });
  }

  function removeMain(id: string) {
    if (!window.confirm(t("deleteMainConfirm"))) return;
    startTransition(async () => {
      const result = await deleteMainCategory({ id });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("mainDeleted"));
      router.refresh();
    });
  }

  function saveSub(id: string, fd: FormData) {
    startTransition(async () => {
      const result = await updateSubCategory({
        id,
        code: String(fd.get("code") ?? "").trim(),
        nameEn: String(fd.get("nameEn") ?? "").trim(),
        nameAr: String(fd.get("nameAr") ?? "").trim(),
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("subUpdated"));
      setEditingSubId(null);
      router.refresh();
    });
  }

  function removeSub(id: string) {
    if (!window.confirm(t("deleteSubConfirm"))) return;
    startTransition(async () => {
      const result = await deleteSubCategory({ id });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("subDeleted"));
      router.refresh();
    });
  }

  const canAddMain =
    mainCode.trim() && mainNameEn.trim().length >= 2 && mainNameAr.trim().length >= 2;
  const canAddSub =
    subParent &&
    subCode.trim() &&
    subNameEn.trim().length >= 2 &&
    subNameAr.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Existing tree */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink-800">
              {t("existing")}
            </h3>
            {categoryTree.length === 0 ? (
              <p className="text-sm text-ink-500">{t("none")}</p>
            ) : (
              <ul className="space-y-2 rounded-lg border border-line bg-surface-alt p-3 text-sm">
                {categoryTree.map((main) => (
                  <li key={main.id} className="space-y-1">
                    {editingMainId === main.id ? (
                      <form
                        className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveMain(main.id, new FormData(e.currentTarget));
                        }}
                      >
                        <Input
                          name="code"
                          dir="ltr"
                          className="w-24 font-data"
                          defaultValue={main.code}
                        />
                        <Input
                          name="nameEn"
                          dir="ltr"
                          className="w-40"
                          defaultValue={main.nameEn}
                        />
                        <Input
                          name="nameAr"
                          dir="rtl"
                          className="w-40"
                          defaultValue={main.nameAr}
                        />
                        <Button type="submit" size="sm" disabled={pending}>
                          {pending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          {t("save")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingMainId(null)}
                        >
                          {t("cancel")}
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-ink-900">
                          {name(main)}{" "}
                          <span className="font-data text-xs text-ink-500">
                            {main.code}
                          </span>
                        </p>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingMainId(main.id)}
                          >
                            {t("editMain")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => removeMain(main.id)}
                          >
                            {t("deleteMain")}
                          </Button>
                        </div>
                      </div>
                    )}
                    {main.subCategories.length > 0 ? (
                      <ul className="mt-1 space-y-1 ps-4 text-ink-700">
                        {main.subCategories.map((sub) => (
                          <li key={sub.id}>
                            {editingSubId === sub.id ? (
                              <form
                                className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-2"
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  saveSub(sub.id, new FormData(e.currentTarget));
                                }}
                              >
                                <Input
                                  name="code"
                                  dir="ltr"
                                  className="w-24 font-data"
                                  defaultValue={sub.code}
                                />
                                <Input
                                  name="nameEn"
                                  dir="ltr"
                                  className="w-40"
                                  defaultValue={sub.nameEn}
                                />
                                <Input
                                  name="nameAr"
                                  dir="rtl"
                                  className="w-40"
                                  defaultValue={sub.nameAr}
                                />
                                <Button type="submit" size="sm" disabled={pending}>
                                  {pending ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : null}
                                  {t("save")}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingSubId(null)}
                                >
                                  {t("cancel")}
                                </Button>
                              </form>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <span>
                                  {name(sub)}{" "}
                                  <span className="font-data text-xs text-ink-500">
                                    {sub.code}
                                  </span>
                                </span>
                                <div className="flex items-center gap-1">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingSubId(sub.id)}
                                  >
                                    {t("editSub")}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={pending}
                                    onClick={() => removeSub(sub.id)}
                                  >
                                    {t("deleteSub")}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Add main category */}
          <section className="space-y-3 rounded-lg border border-line p-4">
            <h3 className="text-sm font-semibold text-ink-800">
              {t("mainSection")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="main-code">{t("code")}</Label>
                <Input
                  id="main-code"
                  dir="ltr"
                  value={mainCode}
                  onChange={(e) => setMainCode(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="main-en">{t("nameEn")}</Label>
                <Input
                  id="main-en"
                  dir="ltr"
                  value={mainNameEn}
                  onChange={(e) => setMainNameEn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="main-ar">{t("nameAr")}</Label>
                <Input
                  id="main-ar"
                  dir="rtl"
                  value={mainNameAr}
                  onChange={(e) => setMainNameAr(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addMain}
              disabled={pending || !canAddMain}
            >
              {t("addMain")}
            </Button>
          </section>

          {/* Add subcategory */}
          <section className="space-y-3 rounded-lg border border-line p-4">
            <h3 className="text-sm font-semibold text-ink-800">
              {t("subSection")}
            </h3>
            <div className="space-y-1.5">
              <Label htmlFor="sub-parent">{t("parent")}</Label>
              <Select value={subParent} onValueChange={setSubParent}>
                <SelectTrigger id="sub-parent">
                  <SelectValue placeholder={t("parentPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {categoryTree.map((main) => (
                    <SelectItem key={main.id} value={main.id}>
                      {name(main)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="sub-code">{t("code")}</Label>
                <Input
                  id="sub-code"
                  dir="ltr"
                  value={subCode}
                  onChange={(e) => setSubCode(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-en">{t("nameEn")}</Label>
                <Input
                  id="sub-en"
                  dir="ltr"
                  value={subNameEn}
                  onChange={(e) => setSubNameEn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-ar">{t("nameAr")}</Label>
                <Input
                  id="sub-ar"
                  dir="rtl"
                  value={subNameAr}
                  onChange={(e) => setSubNameAr(e.target.value)}
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={addSub}
              disabled={pending || !canAddSub}
            >
              {t("addSub")}
            </Button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
