import { z } from "zod";

/** Optional Saudi phone: empty string / null allowed, else +9665XXXXXXXX etc. */
const optionalSaudiPhone = z
  .string()
  .trim()
  .regex(/^\+966[1-9]\d{8}$/, { message: "INVALID_SAUDI_PHONE" })
  .optional()
  .nullable()
  .or(z.literal(""));

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
    companyNameEn: z.string().trim().min(2).max(200),
    companyNameAr: z.string().trim().min(2).max(200),
    fullNameEn: z.string().trim().min(2).max(120),
    fullNameAr: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: optionalSaudiPhone,
    password: passwordSchema,
    confirmPassword: z.string().min(1).max(200),
    locale: z.enum(["ar", "en"]).default("ar"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "PASSWORD_MISMATCH",
  });

export type SignupInput = z.infer<typeof signupSchema>;

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
