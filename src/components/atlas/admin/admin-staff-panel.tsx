"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import type { Role } from "@prisma/client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  ATLAS_STAFF_ROLES,
  inviteAtlasStaffSchema,
  type InviteAtlasStaffInput,
} from "@/lib/validators/admin";
import {
  deactivateAtlasStaff,
  inviteAtlasStaff,
  updateAtlasStaffRole,
} from "@/server/admin/actions";
import type { AtlasStaffUser } from "@/server/admin/queries";

type Props = {
  staff: AtlasStaffUser[];
  canManage: boolean;
  currentUserId: string;
};

export function AdminStaffPanel({ staff, canManage, currentUserId }: Props) {
  const t = useTranslations("adminOps.settings.staff");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(staff);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    setRows(staff);
  }, [staff]);

  const inviteForm = useForm<InviteAtlasStaffInput>({
    resolver: zodResolver(inviteAtlasStaffSchema),
    defaultValues: {
      email: "",
      fullNameEn: "",
      fullNameAr: "",
      role: "INTAKE_OFFICER",
    },
  });

  function showErrorToast(code: string) {
    toast.error(t(`errors.${code}` as "errors.SAVE_FAILED"));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-500">{t("help")}</p>
        {canManage ? (
          <Button type="button" onClick={() => setInviteOpen((v) => !v)}>
            {t("invite")}
          </Button>
        ) : null}
      </div>

      {inviteOpen && canManage ? (
        <form
          className="grid gap-3 rounded-lg border border-line bg-surface-alt p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void inviteForm.handleSubmit((values) => {
              startTransition(async () => {
                const result = await inviteAtlasStaff(values);
                if (!result.ok) {
                  showErrorToast(result.error);
                  return;
                }
                toast.success(t("inviteSent"));
                inviteForm.reset();
                setInviteOpen(false);
                router.refresh();
              });
            })();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="staff-email">{t("fields.email")}</Label>
            <Input
              id="staff-email"
              dir="ltr"
              {...inviteForm.register("email")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("fields.role")}</Label>
            <Select
              value={inviteForm.watch("role")}
              onValueChange={(v) =>
                inviteForm.setValue("role", v as InviteAtlasStaffInput["role"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ATLAS_STAFF_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`roles.${role}` as "roles.SYSTEM_ADMIN")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-name-ar">{t("fields.fullNameAr")}</Label>
            <Input id="staff-name-ar" {...inviteForm.register("fullNameAr")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staff-name-en">{t("fields.fullNameEn")}</Label>
            <Input id="staff-name-en" {...inviteForm.register("fullNameEn")} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {t("sendInvite")}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-surface-alt">
            <tr className="border-b border-line">
              <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                {t("colName")}
              </th>
              <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                {t("fields.role")}
              </th>
              <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                {t("status")}
              </th>
              <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                {t("lastLogin")}
              </th>
              {canManage ? (
                <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                  {tCommon("actions")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((user) => {
              const isSelf = user.id === currentUserId;
              const role = user.roles[0] ?? "INTAKE_OFFICER";
              const name = locale === "ar" ? user.fullNameAr : user.fullNameEn;
              return (
                <tr key={user.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink-900">{name}</p>
                    <p className="font-data text-xs text-ink-500" dir="ltr">
                      {user.email}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-ink-800">
                    {canManage ? (
                      <Select
                        value={role}
                        onValueChange={(next) => {
                          const previous = rows;
                          setRows((list) =>
                            list.map((u) =>
                              u.id === user.id
                                ? { ...u, roles: [next as Role] }
                                : u,
                            ),
                          );
                          startTransition(async () => {
                            const result = await updateAtlasStaffRole({
                              userId: user.id,
                              role: next as InviteAtlasStaffInput["role"],
                            });
                            if (!result.ok) {
                              setRows(previous);
                              showErrorToast(result.error);
                              return;
                            }
                            toast.success(t("roleUpdated"));
                            router.refresh();
                          });
                        }}
                      >
                        <SelectTrigger className="h-9 max-w-[16rem]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ATLAS_STAFF_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`roles.${r}` as "roles.SYSTEM_ADMIN")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span>{t(`roles.${role}` as "roles.SYSTEM_ADMIN")}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {t(`statusValues.${user.status}` as "statusValues.ACTIVE")}
                  </td>
                  <td className="px-3 py-2.5 font-data text-xs text-ink-500">
                    {user.lastLoginAt
                      ? format(new Date(user.lastLoginAt), "PPp", {
                          locale: locale === "ar" ? arSA : enGB,
                        })
                      : "—"}
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2.5">
                      {!isSelf && user.status === "ACTIVE" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!window.confirm(t("confirmDeactivate"))) return;
                            const previous = rows;
                            setRows((list) =>
                              list.map((u) =>
                                u.id === user.id
                                  ? { ...u, status: "DISABLED" }
                                  : u,
                              ),
                            );
                            startTransition(async () => {
                              const result = await deactivateAtlasStaff({
                                userId: user.id,
                              });
                              if (!result.ok) {
                                setRows(previous);
                                showErrorToast(result.error);
                                return;
                              }
                              toast.success(t("deactivated"));
                              router.refresh();
                            });
                          }}
                        >
                          {t("deactivate")}
                        </Button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
