import { z } from "zod";
import { PREFERENCE_EVENTS } from "@/lib/notification-events";
import { SAUDI_REGIONS } from "@/lib/saudi-regions";

const preferenceEventTypes = PREFERENCE_EVENTS.map((e) => e.type) as [
  (typeof PREFERENCE_EVENTS)[number]["type"],
  ...(typeof PREFERENCE_EVENTS)[number]["type"][],
];

const regionCodes = SAUDI_REGIONS.map((r) => r.code) as [
  string,
  ...string[],
];

/** Saudi mobile/landline: +9665XXXXXXXX or +9661XXXXXXXX */
export const saudiPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+966[1-9]\d{8}$/, { message: "INVALID_SAUDI_PHONE" });

/**
 * Saudi CR/VAT/national-address/country are only mandatory for domestic
 * (clientCategory = COMPANY, isInternational = false) clients — see the
 * Organisation.isInternational comment in prisma/schema.prisma. Individual
 * and international clients store these as null, so the schema must relax
 * them or their profile update fails validation before it ever reaches the
 * server action.
 */
export function buildCompanyProfileSchema(requiresSaudiFields: boolean) {
  return z.object({
    nameEn: z.string().trim().min(2).max(200),
    nameAr: z.string().trim().min(2).max(200),
    crNumber: requiresSaudiFields
      ? z.string().trim().min(5).max(20)
      : z.string().trim().max(20),
    vatNumber: requiresSaudiFields
      ? z.string().trim().regex(/^3\d{14}$/, { message: "INVALID_VAT" })
      : z.string().trim().max(20),
    website: z
      .union([
        z.literal(""),
        z.null(),
        z.string().trim().regex(/^https?:\/\/.+/i, { message: "INVALID_URL" }),
      ])
      .transform((v) => (v === "" || v == null ? null : v)),
    email: z.email(),
    phone: saudiPhoneSchema,
    addressLine1: z.string().trim().min(3).max(200),
    addressLine2: z
      .union([z.string().trim().max(200), z.null(), z.literal("")])
      .transform((v) => (v === "" || v == null ? null : v)),
    city: z.string().trim().min(2).max(100),
    region: z.enum(regionCodes),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}$/, { message: "INVALID_POSTAL" }),
    country: requiresSaudiFields
      ? z.literal("SA")
      : z.string().trim().length(2).toUpperCase(),
    nationalAddress: requiresSaudiFields
      ? z.string().trim().regex(/^[A-Z]{4}\d{4}$/, { message: "INVALID_NATIONAL_ADDRESS" })
      : z.string().trim().max(20),
  });
}

export const companyProfileSchema = buildCompanyProfileSchema(true);

export type CompanyProfileInput = z.input<typeof companyProfileSchema>;
export type CompanyProfileValues = z.output<typeof companyProfileSchema>;

/** Roles assignable to client-organisation users via the invite/manage panel. */
export const CLIENT_ROLES = [
  "CLIENT_OWNER",
  "CLIENT_ADMIN",
  "CLIENT_USER",
  "CLIENT_FINANCE",
] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];

export const inviteUserSchema = z.object({
  email: z.email(),
  fullNameEn: z.string().trim().min(2).max(120),
  fullNameAr: z.string().trim().min(2).max(120),
  role: z.enum(CLIENT_ROLES),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const changeUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(CLIENT_ROLES),
});

export const deactivateUserSchema = z.object({
  userId: z.string().min(1),
});

export const preferencesSchema = z.object({
  locale: z.enum(["ar", "en"]),
  notifications: z.array(
    z.object({
      eventType: z.enum(preferenceEventTypes),
      emailEnabled: z.boolean(),
      inAppEnabled: z.boolean(),
    }),
  ),
});

export type PreferencesInput = z.infer<typeof preferencesSchema>;

export const logoUploadMetaSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024),
});
