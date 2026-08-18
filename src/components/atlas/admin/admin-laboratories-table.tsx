"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { STATE_TONE_CLASS } from "@/lib/request-state";
import { cn } from "@/lib/utils";
import {
  createLaboratory,
  createTestType,
  deleteLaboratory,
  deleteTestType,
  toggleLaboratoryActive,
  toggleTestTypeActive,
  updateLaboratory,
  updateTestType,
} from "@/server/admin/actions";
import type { AdminLaboratoryItem, AdminTestTypeItem } from "@/server/admin/queries";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function AdminLaboratoriesTable({ rows }: { rows: AdminLaboratoryItem[] }) {
  const t = useTranslations("adminOps.laboratories.laboratory");
  const tErr = useTranslations("adminOps.laboratories.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [scopeEn, setScopeEn] = useState("");
  const [scopeAr, setScopeAr] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");

  const canAdd = code.trim() && nameEn.trim().length >= 2 && nameAr.trim().length >= 2;

  function resetForm() {
    setCode("");
    setNameEn("");
    setNameAr("");
    setScopeEn("");
    setScopeAr("");
    setContactName("");
    setContactEmail("");
    setContactPhone("");
  }

  function submitAdd() {
    startTransition(async () => {
      const result = await createLaboratory({
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        accreditationScopeEn: scopeEn.trim() || undefined,
        accreditationScopeAr: scopeAr.trim() || undefined,
        contactName: contactName.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("added"));
      resetForm();
      router.refresh();
    });
  }

  function submitEdit(id: string, fd: FormData) {
    startTransition(async () => {
      const result = await updateLaboratory({
        id,
        code: String(fd.get("code") ?? "").trim(),
        nameEn: String(fd.get("nameEn") ?? "").trim(),
        nameAr: String(fd.get("nameAr") ?? "").trim(),
        accreditationScopeEn: String(fd.get("scopeEn") ?? "").trim() || undefined,
        accreditationScopeAr: String(fd.get("scopeAr") ?? "").trim() || undefined,
        contactName: String(fd.get("contactName") ?? "").trim() || undefined,
        contactEmail: String(fd.get("contactEmail") ?? "").trim() || undefined,
        contactPhone: String(fd.get("contactPhone") ?? "").trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("updated"));
      setEditingId(null);
      router.refresh();
    });
  }

  function handleToggle(row: AdminLaboratoryItem) {
    setPendingId(row.id);
    startTransition(async () => {
      const result = await toggleLaboratoryActive({ id: row.id, active: !row.active });
      setPendingId(null);
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(row: AdminLaboratoryItem) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setPendingId(row.id);
    startTransition(async () => {
      const result = await deleteLaboratory({ id: row.id });
      setPendingId(null);
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{t("title")}</h2>
        <p className="text-xs text-ink-500">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">{t("code")}</th>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("contact")}</th>
                <th className="px-3 py-2">{t("status")}</th>
                <th className="px-3 py-2">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                editingId === row.id ? (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td colSpan={5} className="p-3">
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitEdit(row.id, new FormData(e.currentTarget));
                        }}
                      >
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>{t("code")}</Label>
                            <Input name="code" dir="ltr" defaultValue={row.code} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("nameEn")}</Label>
                            <Input name="nameEn" dir="ltr" defaultValue={row.nameEn} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("nameAr")}</Label>
                            <Input name="nameAr" dir="rtl" defaultValue={row.nameAr} />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>{t("scopeEn")}</Label>
                            <Textarea
                              name="scopeEn"
                              dir="ltr"
                              rows={2}
                              defaultValue={row.accreditationScopeEn}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("scopeAr")}</Label>
                            <Textarea
                              name="scopeAr"
                              dir="rtl"
                              rows={2}
                              defaultValue={row.accreditationScopeAr}
                            />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>{t("contactName")}</Label>
                            <Input name="contactName" defaultValue={row.contactName} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("contactEmail")}</Label>
                            <Input
                              name="contactEmail"
                              dir="ltr"
                              defaultValue={row.contactEmail}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("contactPhone")}</Label>
                            <Input
                              name="contactPhone"
                              dir="ltr"
                              defaultValue={row.contactPhone}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
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
                            onClick={() => setEditingId(null)}
                          >
                            {t("cancel")}
                          </Button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                  >
                    <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                      {row.code}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-ink-900">{row.nameEn}</p>
                      <p className="text-xs text-ink-500">{row.nameAr}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-600">
                      {row.contactName || row.contactEmail || row.contactPhone ? (
                        <>
                          {row.contactName ? <p>{row.contactName}</p> : null}
                          {row.contactEmail ? <p dir="ltr">{row.contactEmail}</p> : null}
                        </>
                      ) : (
                        <span className="text-ink-400">{t("noContact")}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                          STATE_TONE_CLASS[row.active ? "ok" : "neutral"],
                        )}
                      >
                        {row.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(row.id)}
                        >
                          {t("edit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingId === row.id}
                          onClick={() => handleToggle(row)}
                        >
                          {pendingId === row.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          {t("toggle")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingId === row.id}
                          onClick={() => handleDelete(row)}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-line p-4">
        <h3 className="text-sm font-semibold text-ink-800">{t("addSection")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("code")}</Label>
            <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("nameEn")}</Label>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("nameAr")}</Label>
            <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("scopeEn")}</Label>
            <Textarea
              dir="ltr"
              rows={2}
              value={scopeEn}
              onChange={(e) => setScopeEn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("scopeAr")}</Label>
            <Textarea
              dir="rtl"
              rows={2}
              value={scopeAr}
              onChange={(e) => setScopeAr(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("contactName")}</Label>
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("contactEmail")}</Label>
            <Input
              dir="ltr"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("contactPhone")}</Label>
            <Input
              dir="ltr"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
        </div>
        <Button type="button" size="sm" disabled={pending || !canAdd} onClick={submitAdd}>
          {t("add")}
        </Button>
      </section>
    </section>
  );
}

export function AdminTestTypesTable({ rows }: { rows: AdminTestTypeItem[] }) {
  const t = useTranslations("adminOps.laboratories.testType");
  const tErr = useTranslations("adminOps.laboratories.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [descEn, setDescEn] = useState("");
  const [descAr, setDescAr] = useState("");

  const canAdd = code.trim() && nameEn.trim().length >= 2 && nameAr.trim().length >= 2;

  function resetForm() {
    setCode("");
    setNameEn("");
    setNameAr("");
    setDescEn("");
    setDescAr("");
  }

  function submitAdd() {
    startTransition(async () => {
      const result = await createTestType({
        code: code.trim(),
        nameEn: nameEn.trim(),
        nameAr: nameAr.trim(),
        descEn: descEn.trim() || undefined,
        descAr: descAr.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("added"));
      resetForm();
      router.refresh();
    });
  }

  function submitEdit(id: string, fd: FormData) {
    startTransition(async () => {
      const result = await updateTestType({
        id,
        code: String(fd.get("code") ?? "").trim(),
        nameEn: String(fd.get("nameEn") ?? "").trim(),
        nameAr: String(fd.get("nameAr") ?? "").trim(),
        descEn: String(fd.get("descEn") ?? "").trim() || undefined,
        descAr: String(fd.get("descAr") ?? "").trim() || undefined,
      });
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("updated"));
      setEditingId(null);
      router.refresh();
    });
  }

  function handleToggle(row: AdminTestTypeItem) {
    setPendingId(row.id);
    startTransition(async () => {
      const result = await toggleTestTypeActive({ id: row.id, active: !row.active });
      setPendingId(null);
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      router.refresh();
    });
  }

  function handleDelete(row: AdminTestTypeItem) {
    if (!window.confirm(t("deleteConfirm"))) return;
    setPendingId(row.id);
    startTransition(async () => {
      const result = await deleteTestType({ id: row.id });
      setPendingId(null);
      if (!result.ok) {
        toast.error(tErr(result.error as "SAVE_FAILED"));
        return;
      }
      toast.success(t("deleted"));
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{t("title")}</h2>
        <p className="text-xs text-ink-500">{t("subtitle")}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-alt text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">{t("code")}</th>
                <th className="px-3 py-2">{t("name")}</th>
                <th className="px-3 py-2">{t("status")}</th>
                <th className="px-3 py-2">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                editingId === row.id ? (
                  <tr key={row.id} className="border-b border-line last:border-b-0">
                    <td colSpan={4} className="p-3">
                      <form
                        className="space-y-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          submitEdit(row.id, new FormData(e.currentTarget));
                        }}
                      >
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="space-y-1.5">
                            <Label>{t("code")}</Label>
                            <Input name="code" dir="ltr" defaultValue={row.code} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("nameEn")}</Label>
                            <Input name="nameEn" dir="ltr" defaultValue={row.nameEn} />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("nameAr")}</Label>
                            <Input name="nameAr" dir="rtl" defaultValue={row.nameAr} />
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>{t("descEn")}</Label>
                            <Textarea
                              name="descEn"
                              dir="ltr"
                              rows={2}
                              defaultValue={row.descEn}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>{t("descAr")}</Label>
                            <Textarea
                              name="descAr"
                              dir="rtl"
                              rows={2}
                              defaultValue={row.descAr}
                            />
                          </div>
                        </div>
                        <div className="flex gap-2">
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
                            onClick={() => setEditingId(null)}
                          >
                            {t("cancel")}
                          </Button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={row.id}
                    className="border-b border-line last:border-b-0 hover:bg-atlas-green-tint/50"
                  >
                    <td className="px-3 py-2.5 font-data text-ink-800" dir="ltr">
                      {row.code}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-ink-900">{row.nameEn}</p>
                      <p className="text-xs text-ink-500">{row.nameAr}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
                          STATE_TONE_CLASS[row.active ? "ok" : "neutral"],
                        )}
                      >
                        {row.active ? t("active") : t("inactive")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingId(row.id)}
                        >
                          {t("edit")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingId === row.id}
                          onClick={() => handleToggle(row)}
                        >
                          {pendingId === row.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : null}
                          {t("toggle")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingId === row.id}
                          onClick={() => handleDelete(row)}
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className="space-y-3 rounded-lg border border-line p-4">
        <h3 className="text-sm font-semibold text-ink-800">{t("addSection")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("code")}</Label>
            <Input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("nameEn")}</Label>
            <Input dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("nameAr")}</Label>
            <Input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("descEn")}</Label>
            <Textarea
              dir="ltr"
              rows={2}
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("descAr")}</Label>
            <Textarea
              dir="rtl"
              rows={2}
              value={descAr}
              onChange={(e) => setDescAr(e.target.value)}
            />
          </div>
        </div>
        <Button type="button" size="sm" disabled={pending || !canAdd} onClick={submitAdd}>
          {t("add")}
        </Button>
      </section>
    </section>
  );
}
