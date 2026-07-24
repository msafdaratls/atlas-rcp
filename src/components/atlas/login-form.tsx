"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/server/auth/login";
import { resendVerificationAction } from "@/server/auth/signup";

const ERROR_CODES = new Set([
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
]);

export function LoginForm() {
  const t = useTranslations("landing");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    setUnverifiedEmail(null);
    setResent(false);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (!result.ok) {
        const code = ERROR_CODES.has(result.error)
          ? result.error
          : "INVALID_CREDENTIALS";
        setError(tAuth(`errors.${code}` as never));
        if (code === "EMAIL_NOT_VERIFIED" && result.email) {
          setUnverifiedEmail(result.email);
        }
        return;
      }
      router.push(result.redirectTo);
      router.refresh();
    });
  }

  function onResend() {
    if (!unverifiedEmail) return;
    const fd = new FormData();
    fd.set("email", unverifiedEmail);
    startTransition(async () => {
      await resendVerificationAction(fd);
      setResent(true);
    });
  }

  const hasError = Boolean(error);

  return (
    <form action={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">{tAuth("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          aria-invalid={hasError}
          aria-describedby={hasError ? "login-error" : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">{tAuth("password")}</Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            minLength={8}
            className="pe-10"
            aria-invalid={hasError}
            aria-describedby={hasError ? "login-error" : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={
              showPassword ? tAuth("hidePassword") : tAuth("showPassword")
            }
            aria-pressed={showPassword}
            className="absolute inset-y-0 end-0 flex items-center pe-3 text-[var(--ink-500)] transition-colors hover:text-[var(--ink-800)] focus-visible:text-[var(--atlas-green)] focus-visible:outline-none"
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div id="login-error" role="alert" className="space-y-1">
          <p className="text-sm text-[var(--state-bad)]">{error}</p>
          {unverifiedEmail && !resent ? (
            <button
              type="button"
              onClick={onResend}
              disabled={pending}
              className="text-sm font-medium text-[var(--atlas-green-600)] underline-offset-4 hover:underline disabled:opacity-50"
            >
              {tAuth("resendVerification")}
            </button>
          ) : null}
          {resent ? (
            <p className="text-sm text-[var(--ink-500)]">{tAuth("resendSent")}</p>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? tAuth("signingIn") : t("signIn")}
      </Button>

      <div className="flex items-center justify-between pt-1 text-xs">
        <Link
          href="/forgot-password"
          className="font-medium text-[var(--atlas-green-600)] underline-offset-4 hover:underline"
        >
          {tAuth("forgotPassword")}
        </Link>
        <span className="text-[var(--ink-500)]">{tAuth("helpHint")}</span>
      </div>
    </form>
  );
}
