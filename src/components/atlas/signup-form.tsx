"use client";

import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FormEvent } from "react";
import { useState, useTransition } from "react";

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
import { COUNTRY_CODES, DEFAULT_DIAL_CODE, countryLabel } from "@/lib/country-codes";
import { signupAction, resendVerificationAction } from "@/server/auth/signup";

const ERROR_CODES = new Set([
  "VALIDATION",
  "EMAIL_TAKEN",
  "CR_TAKEN",
  "PHONE_TAKEN",
  "PASSWORD_MISMATCH",
  "WEAK_PASSWORD",
  "INVALID_PHONE",
  "INVALID_VAT",
  "INVALID_NATIONAL_ADDRESS",
  "REQUIRED",
  "RATE_LIMITED",
  "SIGNUP_FAILED",
]);

type AccountType = "COMPANY" | "INDIVIDUAL";

export function SignupForm({ locale }: { locale: "ar" | "en" }) {
  const t = useTranslations("signup");
  const tAuth = useTranslations("auth");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("COMPANY");
  const [isInternational, setIsInternational] = useState(false);
  const [phoneCountry, setPhoneCountry] = useState<string>(DEFAULT_DIAL_CODE);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);
    formData.set("accountType", accountType);
    formData.set("isInternational", isInternational ? "true" : "false");
    formData.set("phoneCountry", phoneCountry);
    startTransition(async () => {
      const result = await signupAction(formData);
      if (!result.ok) {
        const code = ERROR_CODES.has(result.error)
          ? result.error
          : "SIGNUP_FAILED";
        setError(t(`errors.${code}` as never));
        return;
      }
      setSentTo(result.email);
    });
  }

  function onResend() {
    if (!sentTo) return;
    const fd = new FormData();
    fd.set("email", sentTo);
    fd.set("locale", locale);
    startTransition(async () => {
      await resendVerificationAction(fd);
      setResent(true);
    });
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-alt p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-state-ok" />
          <div className="space-y-1">
            <p className="font-semibold text-ink-900">{t("checkEmailTitle")}</p>
            <p className="text-sm text-ink-500">
              {t("checkEmailBody", { email: sentTo })}
            </p>
          </div>
        </div>
        {resent ? (
          <p className="text-center text-sm text-[var(--ink-500)]">
            {t("resendSent")}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onResend}
            disabled={pending}
          >
            {t("resend")}
          </Button>
        )}
      </div>
    );
  }

  const hasError = Boolean(error);
  const describedBy = hasError ? "signup-error" : undefined;
  const isCompany = accountType === "COMPANY";
  const requiresSaudiFields = isCompany && !isInternational;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <input type="hidden" name="locale" value={locale} />

      <fieldset className="space-y-3" disabled={pending}>
        <legend className="mb-1 font-mono text-xs uppercase tracking-wide text-[var(--ink-500)]">
          {t("sectionAccountType")}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            aria-pressed={isCompany}
            onClick={() => setAccountType("COMPANY")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              isCompany
                ? "border-[var(--atlas-green)] bg-surface-alt text-ink-900"
                : "border-line text-ink-500 hover:text-ink-800"
            }`}
          >
            {t("accountTypeCompany")}
          </button>
          <button
            type="button"
            aria-pressed={!isCompany}
            onClick={() => setAccountType("INDIVIDUAL")}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              !isCompany
                ? "border-[var(--atlas-green)] bg-surface-alt text-ink-900"
                : "border-line text-ink-500 hover:text-ink-800"
            }`}
          >
            {t("accountTypeIndividual")}
          </button>
        </div>
      </fieldset>

      {isCompany ? (
        <fieldset className="space-y-3" disabled={pending}>
          <legend className="mb-1 font-mono text-xs uppercase tracking-wide text-[var(--ink-500)]">
            {t("sectionCompany")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyNameEn">{t("companyNameEn")}</Label>
              <Input id="companyNameEn" name="companyNameEn" required dir="ltr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyNameAr">{t("companyNameAr")}</Label>
              <Input id="companyNameAr" name="companyNameAr" required dir="rtl" />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-alt p-3">
            <Checkbox
              id="isInternational"
              checked={isInternational}
              onCheckedChange={(checked) => setIsInternational(Boolean(checked))}
            />
            <div>
              <Label htmlFor="isInternational" className="cursor-pointer">
                {t("internationalLabel")}
              </Label>
            </div>
          </div>

          {requiresSaudiFields ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="crNumber">{t("crNumber")}</Label>
                <Input
                  id="crNumber"
                  name="crNumber"
                  className="font-data"
                  dir="ltr"
                  required
                  aria-invalid={hasError}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vatNumber">{t("vatNumber")}</Label>
                <Input
                  id="vatNumber"
                  name="vatNumber"
                  className="font-data"
                  dir="ltr"
                  required
                  aria-invalid={hasError}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="nationalAddress">{t("nationalAddress")}</Label>
                <Input
                  id="nationalAddress"
                  name="nationalAddress"
                  className="font-data uppercase"
                  dir="ltr"
                  required
                  aria-invalid={hasError}
                  placeholder="RIYD2342"
                />
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className="space-y-3" disabled={pending}>
        <legend className="mb-1 font-mono text-xs uppercase tracking-wide text-[var(--ink-500)]">
          {t("sectionContact")}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullNameEn">{t("fullNameEn")}</Label>
            <Input id="fullNameEn" name="fullNameEn" required dir="ltr" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fullNameAr">{t("fullNameAr")}</Label>
            <Input id="fullNameAr" name="fullNameAr" required dir="rtl" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            dir="ltr"
            aria-invalid={hasError}
            aria-describedby={describedBy}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phoneNumber">{t("phone")}</Label>
          <div className="flex gap-2" dir="ltr">
            <Select value={phoneCountry} onValueChange={setPhoneCountry}>
              <SelectTrigger className="w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRY_CODES.map((country) => (
                  <SelectItem key={country.iso} value={country.dialCode}>
                    {country.dialCode} {countryLabel(country, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id="phoneNumber"
              name="phoneNumber"
              type="tel"
              autoComplete="tel-national"
              required
              dir="ltr"
              className="flex-1"
              placeholder="5XXXXXXXX"
              aria-invalid={hasError}
              aria-describedby="phone-hint"
            />
          </div>
          <p id="phone-hint" className="text-xs text-[var(--ink-500)]">
            {t("phoneHint")}
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-3" disabled={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="password">{t("password")}</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                className="pe-10"
                aria-invalid={hasError}
                aria-describedby="password-hint"
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
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              aria-invalid={hasError}
              aria-describedby={describedBy}
            />
          </div>
        </div>
        <p id="password-hint" className="text-xs text-[var(--ink-500)]">
          {t("passwordHint")}
        </p>
      </fieldset>

      {error ? (
        <p
          id="signup-error"
          className="text-sm text-[var(--state-bad)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
