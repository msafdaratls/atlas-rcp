"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
  createCredential,
  deactivateCredential,
} from "@/server/company/credentials";
import type { PlatformCredentialSummary } from "@/server/company/credentials";

const PLATFORMS = ["GHAD", "SABER", "FASAH"] as const;

export function PlatformCredentialsPanel({
  initial,
  canManage,
}: {
  initial: PlatformCredentialSummary[];
  canManage: boolean;
}) {
  const t = useTranslations("company.credentials");
  const [credentials, setCredentials] = useState(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [platform, setPlatform] =
    useState<(typeof PLATFORMS)[number]>("GHAD");
  const [label, setLabel] = useState("");
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [secret, setSecret] = useState("");

  function resetForm() {
    setPlatform("GHAD");
    setLabel("");
    setLoginIdentifier("");
    setSecret("");
  }

  function handleCreate() {
    if (!loginIdentifier.trim() || !secret) {
      toast.error(t("errors.VALIDATION"));
      return;
    }
    startTransition(async () => {
      const result = await createCredential({
        platform,
        label: label.trim() || undefined,
        loginIdentifier: loginIdentifier.trim(),
        secret,
      });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setCredentials((prev) => [
        {
          id: result.data.id,
          platform,
          label: label.trim() || null,
          loginIdentifier: loginIdentifier.trim(),
          active: true,
          createdAt: new Date(),
        },
        ...prev,
      ]);
      resetForm();
      setOpen(false);
      toast.success(t("created"));
    });
  }

  function handleDeactivate(credentialId: string) {
    startTransition(async () => {
      const result = await deactivateCredential({ credentialId });
      if (!result.ok) {
        toast.error(t(`errors.${result.error}` as never));
        return;
      }
      setCredentials((prev) => prev.filter((c) => c.id !== credentialId));
      toast.success(t("deactivated"));
    });
  }

  return (
    <Card className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink-900">{t("title")}</h2>
          <p className="text-sm text-ink-500">{t("description")}</p>
        </div>
        {canManage ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="outline">
              {t("add")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("add")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("platform")}</Label>
                <Select
                  value={platform}
                  onValueChange={(v) => setPlatform(v as (typeof PLATFORMS)[number])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("label")}</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t("loginIdentifier")}</Label>
                <Input
                  value={loginIdentifier}
                  onChange={(e) => setLoginIdentifier(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("secret")}</Label>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="text-xs text-ink-500">{t("secretHelp")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </Button>
              <Button type="button" disabled={pending} onClick={handleCreate}>
                {t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        ) : null}
      </div>

      {credentials.length === 0 ? (
        <p className="text-sm text-ink-500">{t("empty")}</p>
      ) : (
        <div className="divide-y divide-line">
          {credentials.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {c.platform}
                  {c.label ? ` — ${c.label}` : ""}
                </p>
                <p className="text-xs text-ink-500">{c.loginIdentifier}</p>
              </div>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => handleDeactivate(c.id)}
                >
                  {t("remove")}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
