"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { arSA, enGB } from "date-fns/locale";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { AddressPreviewCard } from "@/components/atlas/company/address-preview-card";
import { LogoUploader } from "@/components/atlas/company/logo-uploader";
import { useOrganisationBranding } from "@/components/atlas/organisation-branding";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SAUDI_REGIONS } from "@/lib/saudi-regions";
import {
  companyProfileSchema,
  inviteUserSchema,
  type CompanyProfileInput,
  type CompanyProfileValues,
  type InviteUserInput,
  type PreferencesInput,
} from "@/lib/validators/company";
import {
  changeOrganisationUserRole,
  deactivateOrganisationUser,
  inviteOrganisationUser,
  saveCompanyProfile,
  saveOrganisationLogo,
  saveUserPreferences,
} from "@/server/company/actions";
import type { CompanyProfileView } from "@/server/company/queries";

function maskSaudiPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  let national = digits;
  if (national.startsWith("966")) national = national.slice(3);
  if (national.startsWith("0")) national = national.slice(1);
  national = national.slice(0, 9);
  return national.length ? `+966${national}` : "+966";
}

type Props = {
  initial: CompanyProfileView;
};

export function CompanyProfileForm({ initial }: Props) {
  const t = useTranslations("company");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const branding = useOrganisationBranding();
  const [pending, startTransition] = useTransition();
  const [logoUrl, setLogoUrl] = useState(initial.organisation.logoUrl);
  const [users, setUsers] = useState(initial.users);
  const [inviteOpen, setInviteOpen] = useState(false);

  const defaults: CompanyProfileInput = useMemo(
    () => ({
      nameEn: initial.organisation.nameEn,
      nameAr: initial.organisation.nameAr,
      crNumber: initial.organisation.crNumber ?? "",
      vatNumber: initial.organisation.vatNumber ?? "",
      website: initial.organisation.website,
      email: initial.organisation.email,
      phone: initial.organisation.phone ?? "+966",
      addressLine1: initial.organisation.addressLine1 ?? "",
      addressLine2: initial.organisation.addressLine2,
      city: initial.organisation.city ?? "",
      region:
        (initial.organisation.region as CompanyProfileInput["region"]) ||
        "RIYADH",
      postalCode: initial.organisation.postalCode ?? "",
      country: "SA",
      nationalAddress: initial.organisation.nationalAddress ?? "",
    }),
    [initial.organisation],
  );

  const form = useForm<CompanyProfileInput, unknown, CompanyProfileValues>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: defaults,
    mode: "onBlur",
  });

  const watched = form.watch();

  const [prefs, setPrefs] = useState<PreferencesInput>({
    locale: initial.preferences.locale === "en" ? "en" : "ar",
    notifications: initial.preferences.notifications.map((n) => ({
      eventType: n.eventType as PreferencesInput["notifications"][number]["eventType"],
      emailEnabled: n.emailEnabled,
      inAppEnabled: n.inAppEnabled,
    })),
  });

  const inviteForm = useForm<InviteUserInput>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: {
      email: "",
      fullNameEn: "",
      fullNameAr: "",
      role: "CLIENT_USER",
    },
  });

  function fieldError(name: keyof CompanyProfileInput) {
    const err = form.formState.errors[name];
    if (!err?.message) return null;
    return t(`errors.${String(err.message)}` as never) !== `errors.${String(err.message)}`
      ? t(`errors.${String(err.message)}` as never)
      : t("errors.generic");
  }

  function showSavedToast(fields: string[] | undefined) {
    if (!fields || fields.length === 0) {
      toast.success(t("toast.savedNoChanges"));
      return;
    }
    const labels = fields.map((f) => t(`fields.${f}` as never));
    toast.success(t("toast.savedDiff", { fields: labels.join(", ") }));
  }

  function onSaveProfile() {
    void form.handleSubmit((values) => {
      const snapshot = { ...values };
      startTransition(async () => {
        branding.setOrganisationName(
          locale === "ar" ? values.nameAr : values.nameEn,
        );
        const result = await saveCompanyProfile(values);
        if (!result.ok) {
          form.reset(snapshot);
          branding.setOrganisationName(
            locale === "ar"
              ? initial.organisation.nameAr
              : initial.organisation.nameEn,
          );
          toast.error(t(`errors.${result.error}` as never));
          return;
        }
        showSavedToast(result.updatedFields);
        router.refresh();
      });
    })();
  }

  async function onLogoCropped(file: File, previewUrl: string) {
    const previous = logoUrl;
    setLogoUrl(previewUrl);
    branding.setOrganisationLogoUrl(previewUrl);

    const fd = new FormData();
    fd.set("file", file);
    const result = await saveOrganisationLogo(fd);
    if (!result.ok) {
      setLogoUrl(previous);
      branding.setOrganisationLogoUrl(previous);
      toast.error(t(`errors.${result.error}` as never));
      return;
    }
    setLogoUrl(result.data.logoUrl);
    branding.setOrganisationLogoUrl(result.data.logoUrl);
    showSavedToast(result.updatedFields);
  }

  function onSavePreferences() {
    const snapshot = structuredClone(prefs);
    startTransition(async () => {
      const result = await saveUserPreferences(prefs);
      if (!result.ok) {
        setPrefs(snapshot);
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      showSavedToast(result.updatedFields);
      if (prefs.locale !== locale) {
        const path = window.location.pathname.replace(
          /^\/(ar|en)/,
          `/${prefs.locale}`,
        );
        router.push(path);
        return;
      }
      router.refresh();
    });
  }

  return (
    <TooltipProvider>
      <Tabs defaultValue="identity" className="w-full">
        <TabsList>
          <TabsTrigger value="identity">{t("tabs.identity")}</TabsTrigger>
          <TabsTrigger value="contact">{t("tabs.contact")}</TabsTrigger>
          <TabsTrigger value="users">{t("tabs.users")}</TabsTrigger>
          <TabsTrigger value="preferences">{t("tabs.preferences")}</TabsTrigger>
        </TabsList>

        <TabsContent value="identity" className="space-y-6">
          <LogoUploader
            currentUrl={logoUrl}
            disabled={!initial.canEdit || pending}
            onCropped={onLogoCropped}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nameAr">{t("fields.nameAr")}</Label>
              <Input
                id="nameAr"
                disabled={!initial.canEdit}
                {...form.register("nameAr")}
              />
              {fieldError("nameAr") ? (
                <p className="text-xs text-state-bad">{fieldError("nameAr")}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEn">{t("fields.nameEn")}</Label>
              <Input
                id="nameEn"
                disabled={!initial.canEdit}
                {...form.register("nameEn")}
              />
              {fieldError("nameEn") ? (
                <p className="text-xs text-state-bad">{fieldError("nameEn")}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="crNumber">{t("fields.crNumber")}</Label>
              <Input
                id="crNumber"
                className="font-data"
                dir="ltr"
                disabled={!initial.canEdit}
                {...form.register("crNumber")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vatNumber">{t("fields.vatNumber")}</Label>
              <Input
                id="vatNumber"
                className="font-data"
                dir="ltr"
                disabled={!initial.canEdit}
                {...form.register("vatNumber")}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="website">{t("fields.website")}</Label>
              <Input
                id="website"
                dir="ltr"
                disabled={!initial.canEdit}
                {...form.register("website", {
                  setValueAs: (v: string) => (v.trim() === "" ? null : v.trim()),
                })}
              />
            </div>
          </div>
          {initial.canEdit ? (
            <Button type="button" disabled={pending} onClick={onSaveProfile}>
              {t("saveChanges")}
            </Button>
          ) : null}
        </TabsContent>

        <TabsContent value="contact">
          <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="email">{t("fields.email")}</Label>
                  <Input
                    id="email"
                    dir="ltr"
                    disabled={!initial.canEdit}
                    {...form.register("email")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">{t("fields.phone")}</Label>
                  <Input
                    id="phone"
                    dir="ltr"
                    className="font-data"
                    disabled={!initial.canEdit}
                    value={watched.phone}
                    onChange={(e) =>
                      form.setValue("phone", maskSaudiPhone(e.target.value), {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="addressLine1">{t("fields.addressLine1")}</Label>
                  <Input
                    id="addressLine1"
                    disabled={!initial.canEdit}
                    {...form.register("addressLine1")}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="addressLine2">{t("fields.addressLine2")}</Label>
                  <Input
                    id="addressLine2"
                    disabled={!initial.canEdit}
                    {...form.register("addressLine2")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">{t("fields.city")}</Label>
                  <Input
                    id="city"
                    disabled={!initial.canEdit}
                    {...form.register("city")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("fields.region")}</Label>
                  <Select
                    disabled={!initial.canEdit}
                    value={watched.region}
                    onValueChange={(v) =>
                      form.setValue("region", v as CompanyProfileInput["region"], {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SAUDI_REGIONS.map((region) => (
                        <SelectItem key={region.code} value={region.code}>
                          {locale === "ar" ? region.nameAr : region.nameEn}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">{t("fields.postalCode")}</Label>
                  <Input
                    id="postalCode"
                    className="font-data"
                    dir="ltr"
                    disabled={!initial.canEdit}
                    {...form.register("postalCode")}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nationalAddress">
                    {t("fields.nationalAddress")}
                  </Label>
                  <Input
                    id="nationalAddress"
                    className="font-data uppercase"
                    dir="ltr"
                    disabled={!initial.canEdit}
                    {...form.register("nationalAddress")}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("fields.country")}</Label>
                  <Input value={t("address.saudiArabia")} disabled readOnly />
                </div>
              </div>
              {initial.canEdit ? (
                <Button type="button" disabled={pending} onClick={onSaveProfile}>
                  {t("saveChanges")}
                </Button>
              ) : null}
            </div>
            <AddressPreviewCard
              nameEn={watched.nameEn}
              nameAr={watched.nameAr}
              addressLine1={watched.addressLine1}
              addressLine2={watched.addressLine2}
              city={watched.city}
              region={watched.region}
              postalCode={watched.postalCode}
              country={watched.country}
              nationalAddress={watched.nationalAddress}
              crNumber={watched.crNumber}
              vatNumber={watched.vatNumber}
            />
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-500">{t("users.help")}</p>
            {initial.canManageUsers ? (
              <Button type="button" onClick={() => setInviteOpen((v) => !v)}>
                {t("users.invite")}
              </Button>
            ) : null}
          </div>

          {inviteOpen && initial.canManageUsers ? (
            <form
              className="grid gap-3 rounded-lg border border-line bg-surface-alt p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                void inviteForm.handleSubmit((values) => {
                  startTransition(async () => {
                    const result = await inviteOrganisationUser(values);
                    if (!result.ok) {
                      toast.error(t(`errors.${result.error}` as never));
                      return;
                    }
                    toast.success(t("toast.inviteSent"));
                    inviteForm.reset();
                    setInviteOpen(false);
                    router.refresh();
                  });
                })();
              }}
            >
              <div className="space-y-2">
                <Label>{t("fields.email")}</Label>
                <Input dir="ltr" {...inviteForm.register("email")} />
              </div>
              <div className="space-y-2">
                <Label>{t("users.role")}</Label>
                <Select
                  value={inviteForm.watch("role")}
                  onValueChange={(v) =>
                    inviteForm.setValue(
                      "role",
                      v as InviteUserInput["role"],
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLIENT_OWNER">
                      {t("roles.CLIENT_OWNER")}
                    </SelectItem>
                    <SelectItem value="CLIENT_USER">
                      {t("roles.CLIENT_USER")}
                    </SelectItem>
                    <SelectItem value="CLIENT_FINANCE">
                      {t("roles.CLIENT_FINANCE")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("fields.nameAr")}</Label>
                <Input {...inviteForm.register("fullNameAr")} />
              </div>
              <div className="space-y-2">
                <Label>{t("fields.nameEn")}</Label>
                <Input {...inviteForm.register("fullNameEn")} />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {t("users.sendInvite")}
                </Button>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-alt text-start">
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("users.colName")}
                  </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("users.role")}
                  </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("users.status")}
                  </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("users.lastLogin")}
                  </th>
                  {initial.canManageUsers ? (
                    <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                      {tCommon("actions")}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const role = user.roles[0] ?? "CLIENT_USER";
                  const name =
                    locale === "ar" ? user.fullNameAr : user.fullNameEn;
                  return (
                    <tr key={user.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-ink-900">{name}</p>
                        <p className="font-data text-xs text-ink-500" dir="ltr">
                          {user.email}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-ink-800">
                        {initial.canManageUsers && !user.isSelf ? (
                          <Select
                            value={role}
                            onValueChange={(next) => {
                              const previous = users;
                              setUsers((list) =>
                                list.map((u) =>
                                  u.id === user.id ? { ...u, roles: [next] } : u,
                                ),
                              );
                              startTransition(async () => {
                                const result = await changeOrganisationUserRole({
                                  userId: user.id,
                                  role: next as InviteUserInput["role"],
                                });
                                if (!result.ok) {
                                  setUsers(previous);
                                  toast.error(t(`errors.${result.error}` as never));
                                  return;
                                }
                                showSavedToast(result.updatedFields);
                                router.refresh();
                              });
                            }}
                          >
                            <SelectTrigger className="h-9 max-w-[16rem]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="CLIENT_OWNER">
                                {t("roles.CLIENT_OWNER")}
                              </SelectItem>
                              <SelectItem value="CLIENT_USER">
                                {t("roles.CLIENT_USER")}
                              </SelectItem>
                              <SelectItem value="CLIENT_FINANCE">
                                {t("roles.CLIENT_FINANCE")}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span>{t(`roles.${role}` as never)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {t(`status.${user.status}` as never)}
                      </td>
                      <td className="px-3 py-2.5 font-data text-xs text-ink-500">
                        {user.lastLoginAt
                          ? format(new Date(user.lastLoginAt), "PPp", {
                              locale: locale === "ar" ? arSA : enGB,
                            })
                          : "—"}
                      </td>
                      {initial.canManageUsers ? (
                        <td className="px-3 py-2.5">
                          {!user.isSelf && user.status === "ACTIVE" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const previous = users;
                                setUsers((list) =>
                                  list.map((u) =>
                                    u.id === user.id
                                      ? { ...u, status: "DISABLED" }
                                      : u,
                                  ),
                                );
                                startTransition(async () => {
                                  const result =
                                    await deactivateOrganisationUser({
                                      userId: user.id,
                                    });
                                  if (!result.ok) {
                                    setUsers(previous);
                                    toast.error(
                                      t(`errors.${result.error}` as never),
                                    );
                                    return;
                                  }
                                  showSavedToast(result.updatedFields);
                                  router.refresh();
                                });
                              }}
                            >
                              {t("users.deactivate")}
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
          <ul className="space-y-1 text-xs text-ink-500">
            <li>{t("roles.CLIENT_OWNER")}</li>
            <li>{t("roles.CLIENT_USER")}</li>
            <li>{t("roles.CLIENT_FINANCE")}</li>
          </ul>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-6">
          <div className="space-y-2">
            <Label>{t("preferences.language")}</Label>
            <Select
              value={prefs.locale}
              onValueChange={(v) =>
                setPrefs((p) => ({ ...p, locale: v as "ar" | "en" }))
              }
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ar">{t("preferences.langAr")}</SelectItem>
                <SelectItem value="en">{t("preferences.langEn")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="bg-surface-alt">
                <tr className="border-b border-line">
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("preferences.event")}
                  </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("preferences.email")}
                  </th>
                  <th className="px-3 py-2.5 text-start text-xs font-semibold text-ink-500">
                    {t("preferences.inApp")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {initial.preferences.notifications.map((event, index) => {
                  const pref = prefs.notifications[index];
                  if (!pref) return null;
                  const locked = event.locked;
                  return (
                    <tr key={event.eventType} className="border-b border-line last:border-0">
                      <td className="px-3 py-2.5 text-ink-800">
                        {t(`preferences.events.${event.eventType}` as never)}
                      </td>
                      <td className="px-3 py-2.5">
                        {locked ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Checkbox checked disabled />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("preferences.legalLockedHint")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            checked={pref.emailEnabled}
                            onCheckedChange={(checked) =>
                              setPrefs((p) => ({
                                ...p,
                                notifications: p.notifications.map((n, i) =>
                                  i === index
                                    ? { ...n, emailEnabled: Boolean(checked) }
                                    : n,
                                ),
                              }))
                            }
                          />
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {locked ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Checkbox checked disabled />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("preferences.legalLockedHint")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            checked={pref.inAppEnabled}
                            onCheckedChange={(checked) =>
                              setPrefs((p) => ({
                                ...p,
                                notifications: p.notifications.map((n, i) =>
                                  i === index
                                    ? { ...n, inAppEnabled: Boolean(checked) }
                                    : n,
                                ),
                              }))
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button type="button" disabled={pending} onClick={onSavePreferences}>
            {t("saveChanges")}
          </Button>
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
