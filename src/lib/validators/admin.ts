import { z } from "zod";

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
