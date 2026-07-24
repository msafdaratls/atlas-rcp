"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/server/auth/login";

export function LoginForm() {
  const t = useTranslations("landing");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (!result.ok) {
        setError(tAuth("loginFailed"));
        return;
      }
      router.push(result.redirectTo);
      router.refresh();
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
        <p
          id="login-error"
          className="text-sm text-[var(--state-bad)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? tAuth("signingIn") : t("signIn")}
      </Button>

      <p className="pt-1 text-center text-xs text-[var(--ink-500)]">
        {tAuth("helpHint")}
      </p>
    </form>
  );
}
