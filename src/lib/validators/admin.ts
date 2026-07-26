import { z } from "zod";

import { passwordSchema } from "@/lib/validators/auth";

/** Required Saudi phone: +9665XXXXXXXX etc. */
const requiredSaudiPhone = z
  .string()
  .trim()
  .regex(/^\+966[1-9]\d{8}$/, { message: "INVALID_SAUDI_PHONE" });

/**
 * Admin-created client account: company + owner user in one step. The account
 * is created ACTIVE with the email pre-verified, so the owner can sign in with
 * the initial password immediately.
 */
export const createClientSchema = z.object({
  companyNameEn: z.string().trim().min(2).max(200),
  companyNameAr: z.string().trim().min(2).max(200),
  fullNameEn: z.string().trim().min(2).max(120),
  fullNameAr: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: requiredSaudiPhone,
  password: passwordSchema,
  locale: z.enum(["ar", "en"]),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

/** Atlas-side roles assignable via staff invites (mirrors the client invite flow). */
export const ATLAS_STAFF_ROLES = [
  "INTAKE_OFFICER",
  "TECHNICAL_REVIEWER",
  "DECISION_MAKER",
  "FINANCE",
  "CATALOGUE_MANAGER",
  "QUALITY_MANAGER",
  "SYSTEM_ADMIN",
] as const;

export type AtlasStaffRole = (typeof ATLAS_STAFF_ROLES)[number];

export const inviteAtlasStaffSchema = z.object({
  email: z.email(),
  fullNameEn: z.string().trim().min(2).max(120),
  fullNameAr: z.string().trim().min(2).max(120),
  role: z.enum(ATLAS_STAFF_ROLES),
});

export type InviteAtlasStaffInput = z.infer<typeof inviteAtlasStaffSchema>;

export const updateAtlasStaffRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ATLAS_STAFF_ROLES),
});

export type UpdateAtlasStaffRoleInput = z.infer<typeof updateAtlasStaffRoleSchema>;

export const deactivateAtlasStaffSchema = z.object({
  userId: z.string().min(1),
});

export type DeactivateAtlasStaffInput = z.infer<typeof deactivateAtlasStaffSchema>;
