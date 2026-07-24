import { z } from "zod";

/** Optional Saudi phone: empty string / null allowed, else +9665XXXXXXXX etc. */
const optionalSaudiPhone = z
  .string()
  .trim()
  .regex(/^\+966[1-9]\d{8}$/, { message: "INVALID_SAUDI_PHONE" })
  .optional()
  .nullable()
  .or(z.literal(""));

export const signupSchema = z
  .object({
    companyNameEn: z.string().trim().min(2).max(200),
    companyNameAr: z.string().trim().min(2).max(200),
    fullNameEn: z.string().trim().min(2).max(120),
    fullNameAr: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: optionalSaudiPhone,
    password: z.string().min(8).max(200),
    confirmPassword: z.string().min(8).max(200),
    locale: z.enum(["ar", "en"]).default("ar"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "PASSWORD_MISMATCH",
  });

export type SignupInput = z.infer<typeof signupSchema>;
