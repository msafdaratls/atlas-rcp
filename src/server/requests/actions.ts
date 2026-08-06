"use server";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { resolveRequestContext } from "@/lib/request-context";
import { writeAuditLog } from "@/lib/audit";
import {
  exceedsMaxResubmissions,
  invoiceDueAt,
  isNewClientOrg,
  SUBMITTED_LIFECYCLE_WHERE,
} from "@/lib/billing-helpers";
import {
  balanceFromEntries,
  isOverCreditLimit,
} from "@/lib/credit-limit";
import { evaluateCoupon } from "@/lib/coupon";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { computeOrderBreakdown, toNumber } from "@/lib/pricing";
import { requirePermission } from "@/lib/rbac";
import { resolveResubmissionPricePct } from "@/lib/resubmission-price";
import { scopedDb } from "@/lib/scoped-db";
import { mimeAllowed, sniffMime } from "@/lib/mime-sniff";
import { resumeSlaDueAt } from "@/lib/sla";
import { storage } from "@/lib/storage";
import {
  couponDraftSchema,
  createOrSelectDraftSchema,
  removeCouponFromDraftSchema,
  removeRequestDocumentSchema,
  uploadRequestDocumentIdsSchema,
} from "@/lib/validators/requests";
import { appendLedgerEntry } from "@/server/finance/ledger";
import { z } from "zod";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; meta?: Record<string, string> };

async function nextRequestNo(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ATL-${year}-`;
  const latest = await tx.request.findFirst({
    where: { requestNo: { startsWith: prefix } },
    orderBy: { requestNo: "desc" },
    select: { requestNo: true },
  });
  const seq = latest ? Number(latest.requestNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

async function nextInvoiceNo(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const latest = await tx.invoice.findFirst({
    where: { invoiceNo: { startsWith: prefix } },
    orderBy: { invoiceNo: "desc" },
    select: { invoiceNo: true },
  });
  const seq = latest ? Number(latest.invoiceNo.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/**
 * Throws CREDIT_OVER_LIMIT (rolling back the caller's transaction) when the
 * org would exceed its credit limit after applying `upcomingTotal` (projected
 * invoice total, before billing). Call sites must compute the charge first.
 */
async function assertWithinCreditLimit(
  tx: Prisma.TransactionClient,
  orgId: string,
  upcomingTotal: Prisma.Decimal,
): Promise<void> {
  const org = await tx.organisation.findUnique({ where: { id: orgId } });
  if (!org) return;

  const entries = await tx.ledgerEntry.findMany({
    where: { organisationId: orgId },
    select: { debit: true, credit: true },
  });
  const balance = balanceFromEntries(entries);
  if (
    isOverCreditLimit({
      autoHoldWhenOverLimit: org.autoHoldWhenOverLimit,
      creditLimit: org.creditLimit,
      balance,
      upcomingTotal,
    })
  ) {
    throw new Error("CREDIT_OVER_LIMIT");
  }
}

/** Row-lock a request in an expected state; abort if missing / raced. */
async function lockRequestForUpdate(
  tx: Prisma.TransactionClient,
  input: { id: string; organisationId: string; expectedState: string },
): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "Request"
    WHERE id = ${input.id}
      AND "organisationId" = ${input.organisationId}
      AND state::text = ${input.expectedState}
    FOR UPDATE
  `;
  if (!locked[0]) {
    throw new Error("CONFLICT");
  }
}

/**
 * Best-effort CREDIT_LIMIT notification fired after a submit/resubmit was
 * blocked by `assertWithinCreditLimit`. Runs in its own transaction since
 * the blocking transaction already rolled back.
 */
async function notifyCreditLimitReached(organisationId: string): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const { notify } = await import("@/server/notifications/notify");
      const { notificationCopy } = await import("@/server/notifications/copy");
      const copy = notificationCopy("CREDIT_LIMIT");
      await notify(
        {
          event: "CREDIT_LIMIT",
          data: {
            organisationId,
            link: "/client/statement?credit=1",
            dedupeKey: `CREDIT_LIMIT:${organisationId}`,
            ...copy,
          },
        },
        tx,
      );
    });
  } catch {
    // Notification is best-effort — the submit is already blocked either way.
  }
}

async function loadServiceContexts(
  organisationId: string,
  serviceItemIds: string[],
  submissionNo: number,
) {
  const items = await prisma.serviceItem.findMany({
    where: { id: { in: serviceItemIds }, active: true },
    include: {
      subCategory: { include: { mainCategory: true } },
      requiredDocuments: true,
    },
  });
  if (items.length !== new Set(serviceItemIds).size) return null;
  // Preserve caller-requested order (cart order), not the DB's arbitrary order.
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = serviceItemIds.map((id) => byId.get(id)!);

  const priorSubmitted = await prisma.request.count({
    where: {
      organisationId,
      ...SUBMITTED_LIFECYCLE_WHERE,
    },
  });

  return {
    items: ordered,
    submissionNo,
    organisationId,
    isNewClient: isNewClientOrg(priorSubmitted),
  };
}

function couponItemContext(items: Array<{
  id: string;
  subCategoryId: string;
  subCategory: { mainCategoryId: string; mainCategory: { code: string } };
}>) {
  return items.map((i) => ({
    serviceItemId: i.id,
    subCategoryId: i.subCategoryId,
    mainCategoryId: i.subCategory.mainCategoryId,
    mainCategoryCode: i.subCategory.mainCategory.code,
  }));
}

const draftProductSchema = z.object({
  requestItemId: z.string().min(1),
  productNameEn: z.string().trim().min(2).max(200),
  productNameAr: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(120).nullable().optional(),
  productAttrs: z.record(z.string(), z.unknown()),
  /// Org's stored GHAD/SABER/FASAH login to use for this item's external
  /// submission — validated as belonging to the same org before saving.
  platformCredentialId: z.string().min(1).nullable().optional(),
  /// Convenience traceability link to an earlier RequestItem this one's
  /// required info was sourced from (e.g. a FASEH Request# origin).
  sourceRequestItemId: z.string().min(1).nullable().optional(),
});

export async function createOrSelectDraft(
  input: z.infer<typeof createOrSelectDraftSchema>,
): Promise<
  ActionResult<{
    requestId: string;
    requestNo: string;
    items: Array<{ id: string; serviceItemId: string }>;
  }>
> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const parsed = createOrSelectDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const wantedIds = parsed.data.serviceItemIds;

    if (parsed.data.resumeRequestId) {
      const existing = await prisma.request.findFirst({
        where: {
          organisationId: orgId,
          id: parsed.data.resumeRequestId,
          state: "DRAFT",
        },
        include: { items: true },
      });
      if (existing) {
        const currentIds = existing.items.map((i) => i.serviceItemId);
        const sameCart =
          currentIds.length === wantedIds.length &&
          currentIds.every((id) => wantedIds.includes(id));

        if (!sameCart) {
          const svc = await loadServiceContexts(orgId, wantedIds, 1);
          if (!svc) return { ok: false, error: "SERVICE_NOT_FOUND" };

          const switchedBreakdown = computeOrderBreakdown(svc.items);

          const toRemove = existing.items.filter(
            (i) => !wantedIds.includes(i.serviceItemId),
          );
          const docs = await prisma.requestDocument.findMany({
            where: { requestItemId: { in: toRemove.map((i) => i.id) } },
            include: { versions: { select: { storageKey: true } } },
          });
          const storageKeys = docs.flatMap((d) =>
            d.versions.map((v) => v.storageKey),
          );

          await prisma.$transaction(async (tx) => {
            if (toRemove.length > 0) {
              await tx.requestItem.deleteMany({
                where: { id: { in: toRemove.map((i) => i.id) } },
              });
            }
            const toAdd = svc.items.filter(
              (si) => !currentIds.includes(si.id),
            );
            for (const si of toAdd) {
              await tx.requestItem.create({
                data: {
                  requestId: existing.id,
                  serviceItemId: si.id,
                  basePrice: si.basePrice,
                  vatRate: si.vatRate,
                },
              });
            }
            await tx.request.update({
              where: { id: existing.id },
              data: {
                priceCharged: switchedBreakdown.total,
                discountApplied: 0,
                couponCode: null,
              },
            });
          });

          for (const key of storageKeys) {
            await storage.delete(key);
          }
        }
        const items = await prisma.requestItem.findMany({
          where: { requestId: existing.id },
          orderBy: { sortOrder: "asc" },
          select: { id: true, serviceItemId: true },
        });
        return {
          ok: true,
          data: { requestId: existing.id, requestNo: existing.requestNo, items },
        };
      }
    }

    const svc = await loadServiceContexts(orgId, wantedIds, 1);
    if (!svc) return { ok: false, error: "SERVICE_NOT_FOUND" };

    let engagementId: string | null = null;
    if (parsed.data.engagementId) {
      const engagement = await prisma.engagement.findFirst({
        where: {
          id: parsed.data.engagementId,
          organisationId: orgId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!engagement) return { ok: false, error: "ENGAGEMENT_NOT_FOUND" };
      engagementId = engagement.id;
    }

    const draftBreakdown = computeOrderBreakdown(svc.items);

    const created = await prisma.$transaction(async (tx) => {
      const requestNo = await nextRequestNo(tx);
      const request = await tx.request.create({
        data: {
          requestNo,
          organisationId: orgId,
          createdByUserId: session.id,
          state: "DRAFT",
          priceCharged: draftBreakdown.total,
          discountApplied: 0,
          engagementId,
          items: {
            create: svc.items.map((si, idx) => ({
              serviceItemId: si.id,
              basePrice: si.basePrice,
              vatRate: si.vatRate,
              sortOrder: idx,
            })),
          },
        },
      });
      await tx.requestEvent.create({
        data: {
          requestId: request.id,
          toState: "DRAFT",
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "CLIENT_USER",
          note: "Draft created",
        },
      });
      const items = await tx.requestItem.findMany({
        where: { requestId: request.id },
        orderBy: { sortOrder: "asc" },
        select: { id: true, serviceItemId: true },
      });
      return { request, items };
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.create",
      entityType: "Request",
      entityId: created.request.id,
      after: {
        requestNo: created.request.requestNo,
        serviceItemIds: wantedIds,
      },
    });

    return {
      ok: true,
      data: {
        requestId: created.request.id,
        requestNo: created.request.requestNo,
        items: created.items,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function saveDraftProductDetails(
  input: z.infer<typeof draftProductSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const parsed = draftProductSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.requestItem.findFirst({
      where: {
        id: parsed.data.requestItemId,
        request: {
          organisationId: orgId,
          state: { in: ["DRAFT", "RETURNED_TO_CLIENT"] },
        },
      },
      include: { serviceItem: { select: { productAttrSchema: true } } },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    const { validateProductAttrs } = await import("@/lib/attr-schema");
    const attrError = validateProductAttrs(
      item.serviceItem.productAttrSchema,
      parsed.data.productAttrs,
    );
    if (attrError) return { ok: false, error: attrError };

    if (parsed.data.platformCredentialId) {
      const credential = await prisma.platformCredential.findFirst({
        where: {
          id: parsed.data.platformCredentialId,
          organisationId: orgId,
          active: true,
        },
        select: { id: true },
      });
      if (!credential) return { ok: false, error: "CREDENTIAL_NOT_FOUND" };
    }

    if (parsed.data.sourceRequestItemId) {
      const source = await prisma.requestItem.findFirst({
        where: {
          id: parsed.data.sourceRequestItemId,
          request: { organisationId: orgId },
        },
        select: { id: true },
      });
      if (!source || source.id === item.id) {
        return { ok: false, error: "SOURCE_ITEM_NOT_FOUND" };
      }
    }

    await prisma.requestItem.update({
      where: { id: item.id },
      data: {
        productNameEn: parsed.data.productNameEn,
        productNameAr: parsed.data.productNameAr,
        brand: parsed.data.brand ?? null,
        productAttrs: parsed.data.productAttrs as Prisma.InputJsonValue,
        platformCredentialId: parsed.data.platformCredentialId ?? null,
        sourceRequestItemId: parsed.data.sourceRequestItemId ?? null,
      },
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.product",
      entityType: "RequestItem",
      entityId: item.id,
      after: parsed.data as Prisma.InputJsonValue,
    });

    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const discardDraftSchema = z.object({
  requestId: z.string().min(1),
});

/**
 * Client-only discard of a never-submitted draft. `DRAFT` has no entries in
 * `REQUEST_TRANSITIONS` (admin lifecycle table), so this bypasses it
 * deliberately and moves straight to `CANCELLED` with its own audit trail —
 * the draft was never live, so nothing else needs to react to the change.
 */
export async function discardDraftRequest(
  input: z.infer<typeof discardDraftSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const parsed = discardDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    await prisma.$transaction(async (tx) => {
      await tx.request.update({
        where: { id: draft.id },
        data: { state: "CANCELLED" },
      });
      await tx.requestEvent.create({
        data: {
          requestId: draft.id,
          fromState: "DRAFT",
          toState: "CANCELLED",
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "CLIENT_USER",
          note: "Draft discarded by client",
        },
      });
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.discard",
      entityType: "Request",
      entityId: draft.id,
      before: { state: "DRAFT" },
      after: { state: "CANCELLED" },
    });

    revalidatePath("/[locale]/client/requests", "page");

    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function previewCoupon(
  input: z.infer<typeof couponDraftSchema>,
): Promise<
  ActionResult<{
    discount: number;
    subtotal: number;
    vatAmount: number;
    total: number;
  }>
> {
  try {
    const ctx = await resolveRequestContext();
    const orgId = ctx.organisationId;
    const parsed = couponDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
      include: {
        items: {
          include: {
            serviceItem: {
              include: { subCategory: { include: { mainCategory: true } } },
            },
          },
        },
      },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    const coupon = await prisma.coupon.findUnique({
      where: { code: parsed.data.code.trim().toUpperCase() },
    });
    if (!coupon) return { ok: false, error: "NOT_FOUND" };

    const prior = await prisma.couponRedemption.count({
      where: { couponId: coupon.id, organisationId: orgId },
    });
    const priorSubmitted = await prisma.request.count({
      where: { organisationId: orgId, ...SUBMITTED_LIFECYCLE_WHERE },
    });

    const orderSubtotal = draft.items.reduce(
      (sum, i) => sum.plus(i.basePrice),
      new Prisma.Decimal(0),
    );

    const evalResult = evaluateCoupon(coupon, {
      items: couponItemContext(draft.items.map((i) => i.serviceItem)),
      basePrice: orderSubtotal,
      submissionNo: draft.submissionNo,
      organisationId: orgId,
      isNewClient: isNewClientOrg(priorSubmitted),
      priorOrgRedemptions: prior,
    });

    if (!evalResult.ok) {
      return {
        ok: false,
        error: evalResult.reason,
        meta: evalResult.meta,
      };
    }

    const breakdown = computeOrderBreakdown(draft.items, evalResult.discount);

    return {
      ok: true,
      data: {
        discount: toNumber(breakdown.discount),
        subtotal: toNumber(breakdown.subtotal),
        vatAmount: toNumber(breakdown.vatAmount),
        total: toNumber(breakdown.total),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function applyCouponToDraft(
  input: z.infer<typeof couponDraftSchema>,
): Promise<
  ActionResult<{
    couponCode: string;
    discount: number;
    total: number;
  }>
> {
  const parsed = couponDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "VALIDATION" };

  const preview = await previewCoupon(parsed.data);
  if (!preview.ok) return preview;

  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const code = parsed.data.code.trim().toUpperCase();

    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
      select: { id: true, couponCode: true },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    const coupon = await prisma.coupon.findUnique({
      where: { code },
      select: { stackable: true },
    });
    if (!coupon) return { ok: false, error: "NOT_FOUND" };

    if (
      draft.couponCode &&
      draft.couponCode !== code &&
      coupon.stackable === false
    ) {
      return { ok: false, error: "NON_STACKABLE" };
    }

    const updated = await prisma.request.updateMany({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
      data: {
        couponCode: code,
        discountApplied: preview.data.discount,
        priceCharged: preview.data.total,
      },
    });
    if (updated.count === 0) return { ok: false, error: "NOT_FOUND" };

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.coupon.apply",
      entityType: "Request",
      entityId: parsed.data.requestId,
      after: { couponCode: code, discount: preview.data.discount },
    });

    return {
      ok: true,
      data: {
        couponCode: code,
        discount: preview.data.discount,
        total: preview.data.total,
      },
    };
  } catch {
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function removeCouponFromDraft(
  input: z.infer<typeof removeCouponFromDraftSchema>,
): Promise<ActionResult<{ total: number }>> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const parsed = removeCouponFromDraftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
      include: { items: true },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    const breakdown = computeOrderBreakdown(draft.items);

    await prisma.request.update({
      where: { id: draft.id },
      data: {
        couponCode: null,
        discountApplied: 0,
        priceCharged: breakdown.total,
      },
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.coupon.remove",
      entityType: "Request",
      entityId: draft.id,
      before: { couponCode: draft.couponCode },
      after: { couponCode: null },
    });

    return { ok: true, data: { total: toNumber(breakdown.total) } };
  } catch (error) {
    const { logServerError, toUserFacingError } = await import("@/lib/errors");
    const mapped = toUserFacingError(error);
    if (mapped.logDetail && mapped.code === "UNEXPECTED") {
      logServerError("removeCouponFromDraft", mapped.logDetail);
    }
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN") {
      return { ok: false, error: mapped.code };
    }
    return {
      ok: false,
      error: mapped.code === "UNEXPECTED" ? "SAVE_FAILED" : mapped.code,
    };
  }
}

export async function uploadRequestDocument(formData: FormData): Promise<
  ActionResult<{
    documentId: string;
    versionId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    previewUrl: string;
  }>
> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const requiredDocumentIdRaw = formData.get("requiredDocumentId");
    const ids = uploadRequestDocumentIdsSchema.safeParse({
      requestId: String(formData.get("requestId") ?? ""),
      requestItemId: String(formData.get("requestItemId") ?? ""),
      requiredDocumentId:
        typeof requiredDocumentIdRaw === "string" &&
        requiredDocumentIdRaw.length > 0
          ? requiredDocumentIdRaw
          : null,
      label: String(formData.get("label") ?? "Document"),
    });
    if (!ids.success) return { ok: false, error: "VALIDATION" };
    const { requestId, requestItemId, requiredDocumentId } = ids.data;
    const label = ids.data.label ?? "Document";
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return { ok: false, error: "NO_FILE" };
    }

    const orgId = ctx.organisationId;
    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: requestId,
        state: { in: ["DRAFT", "RETURNED_TO_CLIENT"] },
      },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    const item = await prisma.requestItem.findFirst({
      where: { id: requestItemId, requestId: draft.id },
      include: { serviceItem: { include: { requiredDocuments: true } } },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    let accepted = ["application/pdf", "image/png", "image/jpeg"];
    let maxMb = 50;
    if (requiredDocumentId) {
      const reqDoc = item.serviceItem.requiredDocuments.find(
        (d) => d.id === requiredDocumentId,
      );
      if (!reqDoc) return { ok: false, error: "DOC_SLOT_NOT_FOUND" };
      accepted = reqDoc.acceptedMimeTypes;
      maxMb = reqDoc.maxSizeMb;
    }

    if (!accepted.includes(file.type)) {
      const ext = file.name.includes(".")
        ? `.${file.name.split(".").pop()?.toLowerCase()}`
        : file.type || "unknown";
      return {
        ok: false,
        error: "MIME_REJECTED",
        meta: {
          uploadedExt: ext,
          accepted: accepted
            .map((m) => {
              if (m === "application/pdf") return "PDF";
              if (m === "image/png") return "PNG";
              if (m === "image/jpeg") return "JPG";
              return m;
            })
            .join(", "),
        },
      };
    }
    if (file.size > maxMb * 1024 * 1024) {
      return {
        ok: false,
        error: "FILE_TOO_LARGE",
        meta: { maxMb: String(maxMb) },
      };
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, accepted)) {
      const ext = file.name.includes(".")
        ? `.${file.name.split(".").pop()?.toLowerCase()}`
        : "unknown";
      return {
        ok: false,
        error: "MIME_REJECTED",
        meta: {
          uploadedExt: ext,
          accepted: accepted
            .map((m) => {
              if (m === "application/pdf") return "PDF";
              if (m === "image/png") return "PNG";
              if (m === "image/jpeg") return "JPG";
              return m;
            })
            .join(", "),
        },
      };
    }
    const mimeType = sniffed;

    // Scan before persisting — an infected file is never written to storage.
    // With AV_DRIVER=none this is a no-op (returns CLEAN); a clamd outage fails
    // closed (AV_UNAVAILABLE) rather than accepting an unscanned upload.
    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const stored = await storage.put({
      keyPrefix: `orgs/${orgId}/requests/${requestId}`,
      fileName: file.name,
      mimeType,
      body: buffer,
    });

    const result = await prisma.$transaction(async (tx) => {
      let doc = requiredDocumentId
        ? await tx.requestDocument.findFirst({
            where: { requestItemId, requiredDocumentId },
            include: { versions: true },
          })
        : null;

      if (!doc) {
        doc = await tx.requestDocument.create({
          data: {
            requestId,
            requestItemId,
            requiredDocumentId,
            label,
          },
          include: { versions: true },
        });
      }

      const nextVersion =
        (doc.versions.reduce((max, v) => Math.max(max, v.version), 0) || 0) + 1;

      const version = await tx.documentVersion.create({
        data: {
          documentId: doc.id,
          version: nextVersion,
          fileName: file.name,
          mimeType,
          sizeBytes: buffer.byteLength,
          storageKey: stored.key,
          sha256,
          uploadedByUserId: session.id,
          // Scanned above (getAvScanner) — an INFECTED file never reaches here.
          avStatus: "CLEAN",
        },
      });

      await tx.requestDocument.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id, label },
      });

      return { doc, version };
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.document.upload",
      entityType: "RequestDocument",
      entityId: result.doc.id,
      after: {
        fileName: file.name,
        version: result.version.version,
        storageKey: stored.key,
      },
    });

    return {
      ok: true,
      data: {
        documentId: result.doc.id,
        versionId: result.version.id,
        fileName: file.name,
        mimeType,
        sizeBytes: buffer.byteLength,
        storageKey: stored.key,
        previewUrl: storage.publicUrl(stored.key),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    if (message === "AV_UNAVAILABLE") {
      return { ok: false, error: "AV_UNAVAILABLE" };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function removeRequestDocument(
  input: z.infer<typeof removeRequestDocumentSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const orgId = ctx.organisationId;
    const parsed = removeRequestDocumentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: { in: ["DRAFT", "RETURNED_TO_CLIENT"] },
      },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };

    const doc = await prisma.requestDocument.findFirst({
      where: { id: parsed.data.documentId, requestId: draft.id },
      include: { versions: true },
    });
    if (!doc) return { ok: false, error: "NOT_FOUND" };

    await prisma.requestDocument.update({
      where: { id: doc.id },
      data: { currentVersionId: null },
    });
    await prisma.documentVersion.deleteMany({ where: { documentId: doc.id } });
    await prisma.requestDocument.delete({ where: { id: doc.id } });

    for (const v of doc.versions) {
      await storage.delete(v.storageKey);
    }

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.draft.document.remove",
      entityType: "RequestDocument",
      entityId: doc.id,
      before: { requestId: draft.id, label: doc.label },
    });

    return { ok: true, data: undefined };
  } catch (error) {
    const { logServerError, toUserFacingError } = await import("@/lib/errors");
    const mapped = toUserFacingError(error);
    if (mapped.code === "UNEXPECTED") {
      logServerError("removeRequestDocument", mapped.logDetail);
    }
    if (mapped.code === "UNAUTHORIZED" || mapped.code === "FORBIDDEN") {
      return { ok: false, error: mapped.code };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const submitSchema = z.object({
  requestId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(80),
  artworkIsFinal: z.literal(true),
  couponCode: z.string().nullable().optional(),
});

export async function submitRequest(
  input: z.infer<typeof submitSchema>,
): Promise<ActionResult<{ requestId: string; requestNo: string }>> {
  let notifyOrgId: string | undefined;
  try {
    const ctx = await resolveRequestContext();
    const session = ctx.session;
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const orgId = ctx.organisationId;
    notifyOrgId = orgId;

    const existingByKey = await prisma.request.findUnique({
      where: { idempotencyKey: parsed.data.idempotencyKey },
    });
    if (existingByKey) {
      if (existingByKey.organisationId !== orgId) {
        return { ok: false, error: "FORBIDDEN" };
      }
      return {
        ok: true,
        data: {
          requestId: existingByKey.id,
          requestNo: existingByKey.requestNo,
        },
      };
    }

    const draft = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "DRAFT",
      },
      include: {
        items: {
          include: {
            serviceItem: {
              include: {
                requiredDocuments: true,
                subCategory: { include: { mainCategory: true } },
              },
            },
            documents: { include: { currentVersion: true } },
          },
        },
      },
    });
    if (!draft) return { ok: false, error: "NOT_FOUND" };
    if (draft.items.length === 0) return { ok: false, error: "NOT_FOUND" };

    const { validateProductAttrs } = await import("@/lib/attr-schema");
    for (const item of draft.items) {
      if (
        item.productNameEn.trim().length < 2 ||
        item.productNameAr.trim().length < 2
      ) {
        return { ok: false, error: "PRODUCT_DETAILS_MISSING" };
      }
      const attrError = validateProductAttrs(
        item.serviceItem.productAttrSchema,
        item.productAttrs as Record<string, unknown>,
      );
      if (attrError) return { ok: false, error: attrError };

      const mandatory = item.serviceItem.requiredDocuments.filter(
        (d) => d.mandatory,
      );
      for (const req of mandatory) {
        const filled = item.documents.some(
          (d) => d.requiredDocumentId === req.id && d.currentVersion,
        );
        if (!filled) {
          return { ok: false, error: "MANDATORY_DOCS_MISSING" };
        }
      }

      const hasInfected = item.documents.some(
        (d) => d.currentVersion?.avStatus === "INFECTED",
      );
      if (hasInfected) {
        return { ok: false, error: "INFECTED_FILE" };
      }
    }

    let discount = new Prisma.Decimal(0);
    let couponId: string | null = null;
    const couponCode = parsed.data.couponCode?.trim().toUpperCase() || null;

    const submitted = await prisma.$transaction(async (tx) => {
      await lockRequestForUpdate(tx, {
        id: draft.id,
        organisationId: orgId,
        expectedState: "DRAFT",
      });

      const org = await tx.organisation.findUniqueOrThrow({
        where: { id: orgId },
        select: { paymentTermsDays: true, nameEn: true, nameAr: true },
      });

      // Row lock coupon for usage-cap race safety
      if (couponCode) {
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            code: string;
            status: string;
            discountType: string;
            value: Prisma.Decimal;
            maxDiscountAmount: Prisma.Decimal | null;
            minOrderAmount: Prisma.Decimal | null;
            appliesTo: string;
            appliesToIds: string[];
            clientScope: string;
            clientIds: string[];
            validFrom: Date;
            validTo: Date;
            totalUsageLimit: number | null;
            perClientLimit: number | null;
            usedCount: number;
            excludesResubmissions: boolean;
            stackable: boolean;
            nameEn: string;
            nameAr: string;
            createdByUserId: string;
            createdAt: Date;
          }>
        >`SELECT * FROM "Coupon" WHERE upper(code) = ${couponCode} FOR UPDATE`;

        const row = locked[0];
        if (!row) {
          throw new Error("COUPON_NOT_FOUND");
        }

        const coupon = await tx.coupon.findUniqueOrThrow({
          where: { id: row.id },
        });
        const prior = await tx.couponRedemption.count({
          where: { couponId: coupon.id, organisationId: orgId },
        });
        const priorSubmitted = await tx.request.count({
          where: { organisationId: orgId, ...SUBMITTED_LIFECYCLE_WHERE },
        });
        const orderSubtotal = draft.items.reduce(
          (sum, i) => sum.plus(i.basePrice),
          new Prisma.Decimal(0),
        );
        const evalResult = evaluateCoupon(coupon, {
          items: couponItemContext(draft.items.map((i) => i.serviceItem)),
          basePrice: orderSubtotal,
          submissionNo: draft.submissionNo,
          organisationId: orgId,
          isNewClient: isNewClientOrg(priorSubmitted),
          priorOrgRedemptions: prior,
        });
        if (!evalResult.ok) {
          throw new Error(`COUPON_${evalResult.reason}`);
        }
        discount = evalResult.discount;
        couponId = coupon.id;
        await tx.coupon.update({
          where: { id: coupon.id },
          data: { usedCount: { increment: 1 } },
        });
      }

      const breakdown = computeOrderBreakdown(draft.items, discount);

      await assertWithinCreditLimit(tx, orgId, breakdown.total);

      const now = new Date();
      const slaHours = Math.max(...draft.items.map((i) => i.serviceItem.slaHours));
      const slaDueAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

      const updated = await tx.request.update({
        where: { id: draft.id },
        data: {
          state: "SUBMITTED",
          couponCode,
          discountApplied: breakdown.discount,
          priceCharged: breakdown.total,
          submittedAt: now,
          slaDueAt,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: draft.id,
          fromState: "DRAFT",
          toState: "SUBMITTED",
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "CLIENT_USER",
          note: "Request submitted",
        },
      });

      if (couponId) {
        await tx.couponRedemption.create({
          data: {
            couponId,
            organisationId: orgId,
            requestId: draft.id,
            discountApplied: breakdown.discount,
          },
        });
      }

      let invoiceNo: string | null = null;
      let invoiceId: string | null = null;

      if (!breakdown.total.isZero()) {
        invoiceNo = await nextInvoiceNo(tx);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNo,
            organisationId: orgId,
            requestId: draft.id,
            subtotal: breakdown.subtotal,
            discount: breakdown.discount,
            vatAmount: breakdown.vatAmount,
            total: breakdown.total,
            currency: "SAR",
            status: "ISSUED",
            issuedAt: now,
            dueAt: invoiceDueAt(now, org.paymentTermsDays),
            lines: {
              create: draft.items.map((item) => ({
                description: `${item.serviceItem.nameEn} / ${item.serviceItem.nameAr}`,
                qty: 1,
                unitPrice: item.basePrice,
                lineTotal: item.basePrice,
              })),
            },
          },
        });
        invoiceId = invoice.id;

        await appendLedgerEntry(tx, {
          organisationId: orgId,
          type: "INVOICE",
          referenceType: "Invoice",
          referenceId: invoice.id,
          debit: breakdown.total,
          credit: 0,
          descriptionEn: `Pro forma invoice ${invoiceNo} for request ${updated.requestNo}`,
          descriptionAr: `فاتورة مبدئية ${invoiceNo} للطلب ${updated.requestNo}`,
          createdByUserId: session.id,
        });
      }

      const { notify } = await import("@/server/notifications/notify");
      const { notificationCopy } = await import("@/server/notifications/copy");
      await notify(
        {
          event: "REQUEST_SUBMITTED",
          data: {
            requestId: updated.id,
            requestNo: updated.requestNo,
            state: "SUBMITTED",
            link: `/admin/requests/${updated.id}`,
            organisationId: orgId,
            createdByUserId: session.id,
            ...notificationCopy("REQUEST_SUBMITTED", {
              requestNo: updated.requestNo,
              customerNameEn: org.nameEn,
              customerNameAr: org.nameAr,
              serviceNameEn: draft.items[0]?.serviceItem.nameEn ?? "",
              serviceNameAr: draft.items[0]?.serviceItem.nameAr ?? "",
            }),
          },
        },
        tx,
      );

      await notify(
        {
          event: "REQUEST_RECEIVED",
          data: {
            requestId: updated.id,
            requestNo: updated.requestNo,
            state: "SUBMITTED",
            link: `/client/requests/${updated.id}`,
            organisationId: orgId,
            createdByUserId: session.id,
            ...notificationCopy("REQUEST_RECEIVED", {
              requestNo: updated.requestNo,
              slaHours: String(slaHours),
            }),
          },
        },
        tx,
      );

      if (invoiceNo && invoiceId) {
        await notify(
          {
            event: "INVOICE_ISSUED",
            data: {
              requestId: updated.id,
              requestNo: updated.requestNo,
              link: `/client/statement?invoice=${invoiceId}`,
              organisationId: orgId,
              ...notificationCopy("INVOICE_ISSUED", {
                invoiceNo,
                requestNo: updated.requestNo,
                amount: toNumber(breakdown.total).toFixed(2),
              }),
            },
          },
          tx,
        );
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: orgId,
          action: "request.submit",
          entityType: "Request",
          entityId: draft.id,
          after: {
            state: "SUBMITTED",
            invoiceNo,
            total: toNumber(breakdown.total),
            couponCode,
          },
        },
      });

      return updated;
    });

    revalidatePath("/[locale]/client/requests", "page");

    return {
      ok: true,
      data: { requestId: submitted.id, requestNo: submitted.requestNo },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    if (message === "CONFLICT") {
      return { ok: false, error: "CONFLICT" };
    }
    if (message === "CREDIT_OVER_LIMIT") {
      if (notifyOrgId) await notifyCreditLimitReached(notifyOrgId);
      return { ok: false, error: "CREDIT_OVER_LIMIT" };
    }
    if (message === "COUPON_NOT_FOUND") {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (message.startsWith("COUPON_")) {
      return { ok: false, error: message.replace("COUPON_", "") };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const resubmitSchema = z.object({
  requestId: z.string().min(1),
  note: z.string().trim().max(1000).optional(),
});

export async function resubmitReturnedRequest(
  input: z.infer<typeof resubmitSchema>,
): Promise<ActionResult<{ requestId: string; requestNo: string }>> {
  let notifyOrgId: string | undefined;
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create");
    const parsed = resubmitSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { organisationId: orgId } = scopedDb(session);
    notifyOrgId = orgId;
    const request = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: "RETURNED_TO_CLIENT",
      },
      include: {
        items: {
          include: {
            serviceItem: {
              select: {
                nameEn: true,
                nameAr: true,
                basePrice: true,
                vatRate: true,
                slaHours: true,
                maxResubmissions: true,
                resubmissionPricePct: true,
                freeResubmissions: true,
                requiredDocuments: true,
              },
            },
            documents: { include: { currentVersion: true } },
          },
        },
        events: {
          where: { toState: "RETURNED_TO_CLIENT" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    const maxResubmissions = Math.min(
      ...request.items.map((i) => i.serviceItem.maxResubmissions),
    );
    if (exceedsMaxResubmissions(request.submissionNo, maxResubmissions)) {
      return { ok: false, error: "MAX_RESUBMISSIONS" };
    }

    for (const item of request.items) {
      const mandatory = item.serviceItem.requiredDocuments.filter(
        (d) => d.mandatory,
      );
      for (const req of mandatory) {
        const filled = item.documents.some(
          (d) => d.requiredDocumentId === req.id && d.currentVersion,
        );
        if (!filled) {
          return { ok: false, error: "MANDATORY_DOCS_MISSING" };
        }
      }

      const hasInfectedResubmit = item.documents.some(
        (d) => d.currentVersion?.avStatus === "INFECTED",
      );
      if (hasInfectedResubmit) {
        return { ok: false, error: "INFECTED_FILE" };
      }
    }

    const fault = request.events[0]?.faultAttribution;
    if (!fault) {
      return { ok: false, error: "FAULT_MISSING" };
    }
    const nextSubmission = request.submissionNo + 1;
    const resubmissionItems = request.items.map((item) => {
      const pct = resolveResubmissionPricePct({
        fault,
        submissionNo: nextSubmission,
        freeResubmissions: item.serviceItem.freeResubmissions,
        resubmissionPricePct: item.serviceItem.resubmissionPricePct,
      });
      return {
        nameEn: item.serviceItem.nameEn,
        basePrice: item.serviceItem.basePrice.mul(pct),
        vatRate: item.serviceItem.vatRate,
        pct,
      };
    });

    const updated = await prisma.$transaction(async (tx) => {
      await lockRequestForUpdate(tx, {
        id: request.id,
        organisationId: orgId,
        expectedState: "RETURNED_TO_CLIENT",
      });

      const org = await tx.organisation.findUniqueOrThrow({
        where: { id: orgId },
        select: { paymentTermsDays: true, nameEn: true, nameAr: true },
      });

      // If the reviewer who returned it is no longer an active intake
      // officer, drop the assignment so it falls back to the broadcast pool
      // instead of silently notifying nobody.
      let reviewerStillActive = false;
      if (request.assignedToUserId) {
        const reviewer = await tx.user.findFirst({
          where: {
            id: request.assignedToUserId,
            status: "ACTIVE",
            roles: { some: { role: "INTAKE_OFFICER" } },
          },
          select: { id: true },
        });
        reviewerStillActive = !!reviewer;
      }

      const now = new Date();
      const breakdown = computeOrderBreakdown(resubmissionItems);

      if (!breakdown.total.isZero()) {
        await assertWithinCreditLimit(tx, orgId, breakdown.total);
      }

      const resumedSla = resumeSlaDueAt({
        slaDueAt: request.slaDueAt,
        slaPausedAt: request.slaPausedAt,
        resumedAt: now,
      });
      const slaHours = Math.max(
        ...request.items.map((i) => i.serviceItem.slaHours),
      );
      const slaDueAt =
        resumedSla ?? new Date(now.getTime() + slaHours * 60 * 60 * 1000);

      const row = await tx.request.update({
        where: { id: request.id },
        data: {
          // Resubmitting a returned request goes straight back to Application
          // Review, not back to square one — the reviewer's assignment (if
          // they're still active) is left untouched below.
          state: "UNDER_INTAKE_REVIEW",
          submissionNo: nextSubmission,
          submittedAt: now,
          slaDueAt,
          slaPausedAt: null,
          priceCharged: breakdown.total,
          discountApplied: 0,
          couponCode: null,
          ...(reviewerStillActive ? {} : { assignedToUserId: null }),
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId: request.id,
          fromState: "RETURNED_TO_CLIENT",
          toState: "UNDER_INTAKE_REVIEW",
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "CLIENT_USER",
          note:
            parsed.data.note?.trim() || "Resubmitted after return corrections",
          metadata: {
            resubmissionPct: resubmissionItems.map((i) => i.pct.toString()),
            priorSubmissionNo: request.submissionNo,
            fault,
          },
        },
      });

      let invoiceNo: string | null = null;
      let invoiceId: string | null = null;
      if (!breakdown.total.isZero()) {
        invoiceNo = await nextInvoiceNo(tx);
        const invoice = await tx.invoice.create({
          data: {
            invoiceNo,
            organisationId: orgId,
            requestId: request.id,
            subtotal: breakdown.subtotal,
            discount: breakdown.discount,
            vatAmount: breakdown.vatAmount,
            total: breakdown.total,
            currency: "SAR",
            status: "ISSUED",
            issuedAt: now,
            dueAt: invoiceDueAt(now, org.paymentTermsDays),
            lines: {
              create: resubmissionItems.map((item) => ({
                description: `Resubmission ${nextSubmission} — ${item.nameEn}`,
                qty: 1,
                unitPrice: item.basePrice.toDecimalPlaces(2),
                lineTotal: item.basePrice.toDecimalPlaces(2),
              })),
            },
          },
        });
        invoiceId = invoice.id;

        await appendLedgerEntry(tx, {
          organisationId: orgId,
          type: "INVOICE",
          referenceType: "Invoice",
          referenceId: invoice.id,
          debit: breakdown.total,
          credit: 0,
          descriptionEn: `Resubmission pro forma invoice ${invoiceNo} for ${row.requestNo}`,
          descriptionAr: `فاتورة مبدئية لإعادة تقديم ${invoiceNo} للطلب ${row.requestNo}`,
          createdByUserId: session.id,
        });
      }

      const { notify } = await import("@/server/notifications/notify");
      const { notificationCopy } = await import("@/server/notifications/copy");
      await notify(
        {
          event: "REQUEST_RESUBMITTED",
          data: {
            requestId: row.id,
            requestNo: row.requestNo,
            state: "UNDER_INTAKE_REVIEW",
            link: `/admin/requests/${row.id}`,
            organisationId: orgId,
            createdByUserId: session.id,
            assignedToUserId: reviewerStillActive
              ? request.assignedToUserId
              : null,
            ...notificationCopy("REQUEST_RESUBMITTED", {
              requestNo: row.requestNo,
              customerNameEn: org.nameEn,
              customerNameAr: org.nameAr,
              serviceNameEn: request.items[0]?.serviceItem.nameEn ?? "",
              serviceNameAr: request.items[0]?.serviceItem.nameAr ?? "",
            }),
          },
        },
        tx,
      );

      if (invoiceNo && invoiceId) {
        await notify(
          {
            event: "INVOICE_ISSUED",
            data: {
              requestId: row.id,
              requestNo: row.requestNo,
              link: `/client/statement?invoice=${invoiceId}`,
              organisationId: orgId,
              ...notificationCopy("INVOICE_ISSUED", {
                invoiceNo,
                requestNo: row.requestNo,
                amount: toNumber(breakdown.total).toFixed(2),
              }),
            },
          },
          tx,
        );
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: orgId,
          action: "request.resubmit",
          entityType: "Request",
          entityId: request.id,
          after: {
            state: "SUBMITTED",
            submissionNo: nextSubmission,
            invoiceNo,
            total: toNumber(breakdown.total),
          },
        },
      });

      return row;
    });

    revalidatePath("/[locale]/client/requests", "page");
    revalidatePath(`/[locale]/client/requests/${updated.id}`, "page");
    revalidatePath("/[locale]/client/dashboard", "page");
    revalidatePath("/[locale]/client/statement", "page");

    return {
      ok: true,
      data: { requestId: updated.id, requestNo: updated.requestNo },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    if (message === "CONFLICT") {
      return { ok: false, error: "CONFLICT" };
    }
    if (message === "CREDIT_OVER_LIMIT") {
      if (notifyOrgId) await notifyCreditLimitReached(notifyOrgId);
      return { ok: false, error: "CREDIT_OVER_LIMIT" };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const requestReopenSchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().trim().min(10).max(1000),
});

/**
 * Client-initiated ask to reopen a CLOSED/CANCELLED request. Does not change
 * the request's state by itself — it only creates a PENDING
 * `RequestReopenRequest` for Atlas staff to approve (choosing the resume
 * stage) or reject via `decideReopenRequest`.
 */
export async function requestReopen(
  input: z.infer<typeof requestReopenSchema>,
): Promise<ActionResult<{ reopenRequestId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create");
    const parsed = requestReopenSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { organisationId: orgId } = scopedDb(session);
    const { REOPENABLE_STATES } = await import("@/server/admin/queries");

    const request = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
        state: { in: REOPENABLE_STATES },
      },
      select: { id: true, requestNo: true, organisationId: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    const pending = await prisma.requestReopenRequest.findFirst({
      where: { requestId: request.id, status: "PENDING" },
      select: { id: true },
    });
    if (pending) return { ok: false, error: "ALREADY_PENDING" };

    const reopenRequestId = await prisma.$transaction(async (tx) => {
      const created = await tx.requestReopenRequest.create({
        data: {
          requestId: request.id,
          reason: parsed.data.reason,
          requestedByUserId: session.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: orgId,
          action: "request.reopen.request",
          entityType: "Request",
          entityId: request.id,
          after: { reopenRequestId: created.id, reason: parsed.data.reason },
        },
      });

      try {
        const { notify } = await import("@/server/notifications/notify");
        const { notificationCopy } = await import(
          "@/server/notifications/copy"
        );
        await notify(
          {
            event: "REOPEN_REQUESTED",
            data: {
              requestId: request.id,
              requestNo: request.requestNo,
              link: `/admin/requests/${request.id}`,
              organisationId: orgId,
              ...notificationCopy("REOPEN_REQUESTED", {
                requestNo: request.requestNo,
              }),
            },
          },
          tx,
        );
      } catch (error) {
        log.error("requests.reopen.request", "notification delivery failed", {
          requestId: request.id,
          error: error instanceof Error ? error.message : "unknown",
        });
      }

      return created.id;
    });

    revalidatePath(`/[locale]/client/requests/${request.id}`, "page");

    return { ok: true, data: { reopenRequestId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const clientCommentSchema = z.object({
  requestId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

/**
 * A request with no lifecycle history (DRAFT) or a dead one (CANCELLED) has
 * no thread to message on. CLOSED requests are locked against further
 * editing, including new messages, once finalized.
 */
function canMessageOnRequestState(state: string): boolean {
  return state !== "DRAFT" && state !== "CANCELLED" && state !== "CLOSED";
}

export async function addClientRequestComment(
  input: z.infer<typeof clientCommentSchema>,
): Promise<ActionResult<{ commentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create");
    const parsed = clientCommentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { organisationId: orgId } = scopedDb(session);
    const request = await prisma.request.findFirst({
      where: {
        organisationId: orgId,
        id: parsed.data.requestId,
      },
      select: {
        id: true,
        requestNo: true,
        organisationId: true,
        state: true,
        assignedToUserId: true,
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (!canMessageOnRequestState(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.requestComment.create({
        data: {
          requestId: request.id,
          authorUserId: session.id,
          direction: "CLIENT_TO_ATLAS",
          bodyEn: parsed.data.body,
          bodyAr: parsed.data.body,
        },
      });

      const { notify } = await import("@/server/notifications/notify");
      const { notificationCopy } = await import("@/server/notifications/copy");
      await notify(
        {
          event: "COMMENT_ADDED",
          data: {
            requestId: request.id,
            requestNo: request.requestNo,
            link: `/admin/requests/${request.id}`,
            organisationId: request.organisationId,
            assignedToUserId: request.assignedToUserId,
            commentDirection: "CLIENT_TO_ATLAS",
            ...notificationCopy("COMMENT_ADDED_FROM_CLIENT", {
              requestNo: request.requestNo,
              message: parsed.data.body,
            }),
          },
        },
        tx,
      );

      return created;
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.comment.create",
      entityType: "RequestComment",
      entityId: comment.id,
      after: { requestId: request.id, direction: "CLIENT_TO_ATLAS" },
    });

    revalidatePath(`/[locale]/client/requests/${request.id}`, "page");
    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");

    return { ok: true, data: { commentId: comment.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const markRequestCommentsReadSchema = z.object({ requestId: z.string().min(1) });

/** Marks Atlas's replies and the matching in-app notification read once the client opens the chat thread. */
export async function markClientRequestCommentsRead(
  input: z.infer<typeof markRequestCommentsReadSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create");
    const parsed = markRequestCommentsReadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { organisationId: orgId } = scopedDb(session);
    const request = await prisma.request.findFirst({
      where: { organisationId: orgId, id: parsed.data.requestId },
      select: { id: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    await prisma.$transaction([
      prisma.requestComment.updateMany({
        where: {
          requestId: request.id,
          direction: "ATLAS_TO_CLIENT",
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
      prisma.notification.updateMany({
        where: {
          userId: session.id,
          link: `/client/requests/${request.id}`,
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
    ]);

    revalidatePath(`/[locale]/client/requests/${request.id}`, "page");
    return { ok: true, data: { ok: true } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
