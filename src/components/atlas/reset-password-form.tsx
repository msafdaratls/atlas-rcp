"use client";

import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/lib/i18n/navigation";
import { resetPasswordAction } from "@/server/auth/password";

const ERROR_CODES = new Set([
  "VALIDATION",
  "PASSWORD_MISMATCH",
  "WEAK_PASSWORD",
  "INVALID_TOKEN",
  "RATE_LIMITED",
  "SAVE_FAILED",
]);

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("resetPassword");
  const tAuth = useTranslations("auth");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [show, setShow] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await resetPasswordAction(formData);
      if (!result.ok) {
        const code = ERROR_CODES.has(result.error) ? result.error : "SAVE_FAILED";
        setError(t(`errors.${code}` as never));
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" />
          <div className="space-y-1">
            <p className="font-semibold text-ink-900">{t("successTitle")}</p>
            <p className="text-sm text-ink-500">{t("successBody")}</p>
          </div>
        </div>
        <Button asChild className="w-full">
          <Link href="/login">{t("signIn")}</Link>
        </Button>
      </div>
    );
  }

  const hasError = Boolean(error);

  return (
    <form action={onSubmit} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
            className="pe-10"
            aria-invalid={hasError}
            aria-describedby="reset-hint"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? tAuth("hidePassword") : tAuth("showPassword")}
            aria-pressed={show}
            className="absolute inset-y-0 end-0 flex items-center pe-3 text-[var(--ink-500)] transition-colors hover:text-[var(--ink-800)] focus-visible:text-[var(--atlas-green)] focus-visible:outline-none"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <p id="reset-hint" className="text-xs text-[var(--ink-500)]">
          {t("passwordHint")}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          aria-invalid={hasError}
          aria-describedby={hasError ? "reset-error" : undefined}
        />
      </div>

      {error ? (
        <p id="reset-error" className="text-sm text-[var(--state-bad)]" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
