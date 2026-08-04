import { z } from "zod";

import { COUNTRY_CODES, DEFAULT_DIAL_CODE, findCountryByDialCode } from "@/lib/country-codes";

const dialCodes = COUNTRY_CODES.map((c) => c.dialCode) as [string, ...string[]];

/**
 * Password policy: ≥8 chars with at least one letter and one digit. Kept
 * deliberately modest so it doesn't frustrate users while blocking the weakest
 * passwords; the WEAK_PASSWORD message documents the rule.
 */
export const passwordSchema = z
  .string()
  .min(8, { message: "WEAK_PASSWORD" })
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), {
    message: "WEAK_PASSWORD",
  });

export const signupSchema = z
  .object({
    accountType: z.enum(["COMPANY", "INDIVIDUAL"]).default("COMPANY"),
    /** Company accounts only — skips Saudi CR/VAT/national-address and is unique by email. */
    isInternational: z.coerce.boolean().default(false),
    companyNameEn: z.string().trim().max(200).optional().default(""),
    companyNameAr: z.string().trim().max(200).optional().default(""),
    crNumber: z.string().trim().max(20).optional().default(""),
    vatNumber: z.string().trim().max(20).optional().default(""),
    nationalAddress: z.string().trim().max(20).optional().default(""),
    fullNameEn: z.string().trim().min(2).max(120),
    fullNameAr: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phoneCountry: z.enum(dialCodes).default(DEFAULT_DIAL_CODE),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\d{6,12}$/, { message: "INVALID_PHONE" }),
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(200),
    locale: z.enum(["ar", "en"]).default("ar"),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "PASSWORD_MISMATCH",
      });
    }

    const country = findCountryByDialCode(data.phoneCountry);
    const nsn = data.phoneNumber.replace(/^0+/, "");
    if (!country || nsn.length !== country.nsnLength) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "INVALID_PHONE" });
    }

    if (data.accountType === "COMPANY") {
      if (data.companyNameEn.trim().length < 2) {
        ctx.addIssue({ code: "custom", path: ["companyNameEn"], message: "REQUIRED" });
      }
      if (data.companyNameAr.trim().length < 2) {
        ctx.addIssue({ code: "custom", path: ["companyNameAr"], message: "REQUIRED" });
      }
      if (!data.isInternational) {
        if (data.crNumber.trim().length < 5) {
          ctx.addIssue({ code: "custom", path: ["crNumber"], message: "REQUIRED" });
        }
        if (!/^3\d{14}$/.test(data.vatNumber.trim())) {
          ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "INVALID_VAT" });
        }
        if (!/^[A-Z]{4}\d{4}$/.test(data.nationalAddress.trim())) {
          ctx.addIssue({
            code: "custom",
            path: ["nationalAddress"],
            message: "INVALID_NATIONAL_ADDRESS",
          });
        }
      }
    }
  });

export type SignupInput = z.infer<typeof signupSchema>;

/** Builds the E.164-ish phone string stored on Organisation/User from the form's split fields. */
export function composeSignupPhone(data: Pick<SignupInput, "phoneCountry" | "phoneNumber">) {
  return `${data.phoneCountry}${data.phoneNumber.replace(/^0+/, "")}`;
}

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  locale: z.enum(["ar", "en"]).default("ar"),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10).max(200),
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "PASSWORD_MISMATCH",
  });
