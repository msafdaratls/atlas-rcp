"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import { requestPasswordResetAction } from "@/server/auth/password";

export function ForgotPasswordForm({ locale }: { locale: "ar" | "en" }) {
  const t = useTranslations("forgotPassword");
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      await requestPasswordResetAction(formData);
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" />
          <div className="space-y-1">
            <p className="font-semibold text-ink-900">{t("sentTitle")}</p>
            <p className="text-sm text-ink-500">{t("sentBody")}</p>
          </div>
        </div>
        <Link
          href="/login"
          className="block text-center text-sm font-medium text-[var(--atlas-green-600)] underline-offset-4 hover:underline"
        >
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form action={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="locale" value={locale} />
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          dir="ltr"
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
      <Link
        href="/login"
        className="block text-center text-sm text-[var(--ink-500)] underline-offset-4 hover:underline"
      >
        {t("backToSignIn")}
      </Link>
    </form>
  );
}
