import { z } from "zod";

export const createOrSelectDraftSchema = z.object({
  serviceItemId: z.string().min(1),
  resumeRequestId: z.string().min(1).nullable().optional(),
});

export const couponDraftSchema = z.object({
  requestId: z.string().min(1),
  code: z.string().trim().min(1).max(64),
});

export const removeCouponFromDraftSchema = z.object({
  requestId: z.string().min(1),
});

export const uploadRequestDocumentIdsSchema = z.object({
  requestId: z.string().min(1),
  requiredDocumentId: z.string().min(1).nullable().optional(),
  label: z.string().trim().min(1).max(200).optional(),
});

export const removeRequestDocumentSchema = z.object({
  requestId: z.string().min(1),
  documentId: z.string().min(1),
});
