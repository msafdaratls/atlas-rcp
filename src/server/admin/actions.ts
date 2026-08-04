"use server";

import { randomBytes } from "node:crypto";
import { Prisma, type RequestState } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  computeAssessment,
  hasCheckItems,
  parseCheckSets,
  type AssessmentState,
} from "@/lib/assessment";
import { writeAuditLog } from "@/lib/audit";
import { parsePercentCouponValue } from "@/lib/billing-helpers";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { canTransitionRequest, requirePermission } from "@/lib/rbac";
import { parseMoneyInput } from "@/lib/pricing";
import { resumeSlaDueAt } from "@/lib/sla";
import {
  createClientSchema,
  deactivateAtlasStaffSchema,
  inviteAtlasStaffSchema,
  updateAtlasStaffRoleSchema,
  type CreateClientInput,
  type DeactivateAtlasStaffInput,
  type InviteAtlasStaffInput,
  type UpdateAtlasStaffRoleInput,
} from "@/lib/validators/admin";
import { allowedTransitionsFor, onHoldResumeTarget } from "@/server/admin/queries";
import { appendReversingEntry } from "@/server/finance/ledger";
import { getEmailAdapter } from "@/server/notifications/email-adapter";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Entering these states with no reviewer yet auto-assigns the acting user. */
const REVIEW_ASSIGNMENT_STATES: RequestState[] = [
  "UNDER_INTAKE_REVIEW",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
];

function notificationEventForState(
  state: RequestState,
): "REQUEST_RETURNED" | "REQUEST_ACCEPTED" | "REPORT_ISSUED" | null {
  if (state === "RETURNED_TO_CLIENT") return "REQUEST_RETURNED";
  if (state === "ACCEPTED") return "REQUEST_ACCEPTED";
  if (state === "REPORT_ISSUED") return "REPORT_ISSUED";
  return null;
}

const REQUEST_STATES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "REPORT_ISSUED",
  "CLOSED",
  "CANCELLED",
  "ON_HOLD",
] as const;

const RETURN_REASON_CODES = [
  "MISSING_ARTWORK",
  "ILLEGIBLE_SCAN",
  "LOW_RESOLUTION",
  "WRONG_PRODUCT_TYPE",
  "MISSING_COA",
  "MISSING_FORMULA",
  "INCOMPLETE_FORMULA",
  "EXPIRED_DOCUMENT",
  "WRONG_LANGUAGE",
  "MISMATCHED_PRODUCT",
  "OTHER",
] as const;

const FAULT_ATTRIBUTIONS = [
  "CLIENT_FAULT",
  "ATLAS_FAULT",
  "REGULATORY_CHANGE",
] as const;

const transitionSchema = z.object({
  requestId: z.string().min(1),
  toState: z.enum(REQUEST_STATES),
  note: z.string().trim().max(1000).optional(),
  reasonCode: z.enum(RETURN_REASON_CODES).optional(),
  faultAttribution: z.enum(FAULT_ATTRIBUTIONS).optional(),
});

export async function transitionAdminRequest(
  input: z.infer<typeof transitionSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = transitionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { requestId, toState, note, reasonCode, faultAttribution } = parsed.data;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { createdBy: { select: { id: true } } },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    const allowed = allowedTransitionsFor({
      state: request.state,
      heldFromState: request.heldFromState,
    });
    if (!allowed.includes(toState)) {
      return { ok: false, error: "INVALID_TRANSITION" };
    }

    // Leaving ON_HOLD: only resume to heldFromState (or safe default), unless cancelling.
    if (request.state === "ON_HOLD" && toState !== "CANCELLED") {
      const resume = onHoldResumeTarget(request.heldFromState);
      if (toState !== resume) {
        return { ok: false, error: "INVALID_TRANSITION" };
      }
    }

    if (
      !canTransitionRequest(session, toState, {
        fromState: request.state,
        heldFromState: request.heldFromState,
      })
    ) {
      return { ok: false, error: "FORBIDDEN" };
    }

    if (toState === "RETURNED_TO_CLIENT" && (!reasonCode || !faultAttribution)) {
      return { ok: false, error: "RETURN_REASON_REQUIRED" };
    }

    const now = new Date();
    const closedAt =
      toState === "CLOSED" ? now : toState === "REPORT_ISSUED" ? null : undefined;
    const assignedToUserId =
      request.assignedToUserId === null && REVIEW_ASSIGNMENT_STATES.includes(toState)
        ? session.id
        : undefined;

    const heldFromUpdate =
      toState === "ON_HOLD"
        ? { heldFromState: request.state }
        : request.state === "ON_HOLD"
          ? { heldFromState: null }
          : {};

    const enteringPause =
      toState === "ON_HOLD" || toState === "RETURNED_TO_CLIENT";
    const leavingHold =
      request.state === "ON_HOLD" && toState !== "CANCELLED";

    let slaDueAtUpdate: Date | null | undefined;
    if (leavingHold) {
      slaDueAtUpdate = resumeSlaDueAt({
        slaDueAt: request.slaDueAt,
        slaPausedAt: request.slaPausedAt,
        resumedAt: now,
      });
    }

    const slaFields = enteringPause
      ? { slaPausedAt: request.slaPausedAt ?? now }
      : leavingHold
        ? {
            slaPausedAt: null as Date | null,
            ...(slaDueAtUpdate ? { slaDueAt: slaDueAtUpdate } : {}),
          }
        : toState === "CANCELLED"
          ? { slaPausedAt: null as Date | null }
          : {};

    await prisma.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        where: { id: requestId, state: request.state },
        data: {
          state: toState,
          ...heldFromUpdate,
          ...(closedAt !== undefined ? { closedAt } : {}),
          ...(assignedToUserId !== undefined ? { assignedToUserId } : {}),
          ...slaFields,
        },
      });
      if (updated.count === 0) {
        throw new Error("CONFLICT");
      }

      await tx.requestEvent.create({
        data: {
          requestId,
          fromState: request.state,
          toState,
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
          note: note ?? null,
          reasonCode: reasonCode ?? null,
          faultAttribution: faultAttribution ?? null,
        },
      });

      if (toState === "CANCELLED") {
        const openInvoices = await tx.invoice.findMany({
          where: {
            requestId,
            status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          },
        });
        for (const invoice of openInvoices) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: "VOID" },
          });

          const ledgerEntries = await tx.ledgerEntry.findMany({
            where: {
              referenceType: "Invoice",
              referenceId: invoice.id,
              reversedBy: { none: {} },
            },
          });
          for (const entry of ledgerEntries) {
            await appendReversingEntry(tx, {
              originalEntryId: entry.id,
              createdByUserId: session.id,
              reasonEn: `Void invoice ${invoice.invoiceNo} (request cancelled)`,
              reasonAr: `إلغاء فاتورة ${invoice.invoiceNo} (طلب ملغى)`,
            });
          }

          await tx.auditLog.create({
            data: {
              actorUserId: session.id,
              actorRole: session.roles[0],
              organisationId: request.organisationId,
              action: "invoice.void",
              entityType: "Invoice",
              entityId: invoice.id,
              before: { status: invoice.status },
              after: { status: "VOID", reason: "request.cancelled" },
            },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action: "request.transition",
          entityType: "Request",
          entityId: requestId,
          before: {
            state: request.state,
            heldFromState: request.heldFromState,
          },
          after: {
            state: toState,
            heldFromState:
              toState === "ON_HOLD"
                ? request.state
                : request.state === "ON_HOLD"
                  ? null
                  : request.heldFromState,
            reasonCode,
            faultAttribution,
          },
        },
      });

      try {
        const { notify } = await import("@/server/notifications/notify");
        const { notificationCopy } = await import(
          "@/server/notifications/copy"
        );

        if (assignedToUserId) {
          const assignedCopy = notificationCopy("REQUEST_ASSIGNED", {
            requestNo: request.requestNo,
          });
          await notify(
            {
              event: "REQUEST_ASSIGNED",
              data: {
                requestId,
                requestNo: request.requestNo,
                state: toState,
                link: `/admin/requests/${requestId}`,
                organisationId: request.organisationId,
                assignedToUserId,
                ...assignedCopy,
              },
            },
            tx,
          );
        }

        const eventType = notificationEventForState(toState);
        if (eventType && request.createdBy) {
          const copy = notificationCopy(eventType, {
            requestNo: request.requestNo,
          });
          await notify(
            {
              event: eventType,
              data: {
                requestId,
                requestNo: request.requestNo,
                state: toState,
                link: `/client/requests/${requestId}`,
                organisationId: request.organisationId,
                createdByUserId: request.createdBy.id,
                ...copy,
              },
            },
            tx,
          );
        }
      } catch (error) {
        // Notification delivery is best-effort; the transition itself must still succeed.
        log.error("admin.requests.transition", "notification delivery failed", {
          requestId,
          toState,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    });

    revalidatePath("/[locale]/admin/requests", "page");
    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    revalidatePath("/[locale]/admin/queues", "page");

    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    if (message === "CONFLICT") {
      return { ok: false, error: "CONFLICT" };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const assignRequestSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().min(1).nullable(),
});

export type AssignRequestInput = z.infer<typeof assignRequestSchema>;

/** Assigns (or unassigns, when userId is null) a request to any active Atlas staff member. */
export async function assignRequest(
  input: AssignRequestInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = assignRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestId, userId } = parsed.data;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        state: true,
        requestNo: true,
        organisationId: true,
        assignedToUserId: true,
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (request.state === "DRAFT") return { ok: false, error: "INVALID_STATE" };

    let assignee: { id: string; fullNameEn: string; fullNameAr: string } | null =
      null;
    if (userId) {
      assignee = await prisma.user.findFirst({
        where: { id: userId, status: "ACTIVE", organisation: { type: "ATLAS" } },
        select: { id: true, fullNameEn: true, fullNameAr: true },
      });
      if (!assignee) return { ok: false, error: "NOT_FOUND" };
    }

    if (request.assignedToUserId === (assignee?.id ?? null)) {
      return { ok: true, data: undefined };
    }

    await prisma.$transaction(async (tx) => {
      await tx.request.update({
        where: { id: requestId },
        data: { assignedToUserId: assignee?.id ?? null },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action: "request.assign",
          entityType: "Request",
          entityId: requestId,
          before: { assignedToUserId: request.assignedToUserId },
          after: { assignedToUserId: assignee?.id ?? null },
        },
      });

      if (assignee) {
        try {
          const { notify } = await import("@/server/notifications/notify");
          const { notificationCopy } = await import(
            "@/server/notifications/copy"
          );
          const copy = notificationCopy("REQUEST_ASSIGNED", {
            requestNo: request.requestNo,
          });
          await notify(
            {
              event: "REQUEST_ASSIGNED",
              data: {
                requestId,
                requestNo: request.requestNo,
                link: `/admin/requests/${requestId}`,
                organisationId: request.organisationId,
                assignedToUserId: assignee.id,
                ...copy,
              },
            },
            tx,
          );
        } catch (error) {
          log.error("admin.requests.assign", "notification delivery failed", {
            requestId,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
    });

    revalidatePath("/[locale]/admin/requests", "page");
    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    revalidatePath("/[locale]/admin/queues", "page");

    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const internalCommentSchema = z.object({
  requestId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

export async function addAdminInternalComment(
  input: z.infer<typeof internalCommentSchema>,
): Promise<ActionResult<{ commentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = internalCommentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: { id: true, organisationId: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    const comment = await prisma.requestComment.create({
      data: {
        requestId: request.id,
        authorUserId: session.id,
        direction: "INTERNAL",
        bodyEn: parsed.data.body,
        bodyAr: parsed.data.body,
      },
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.comment.internal",
      entityType: "RequestComment",
      entityId: comment.id,
      after: { requestId: request.id },
    });

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

/** States in which a reviewer may edit the item-level assessment. */
const ASSESSMENT_EDIT_STATES: RequestState[] = [
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
];

const saveAssessmentSchema = z.object({
  requestId: z.string().min(1),
  verdicts: z.record(
    z.string(),
    z.enum(["COMPLIANT", "NON_COMPLIANT", "NA"]),
  ),
  notes: z.record(z.string(), z.string().trim().max(1000)).optional(),
});

export async function saveAssessment(
  input: z.infer<typeof saveAssessmentSchema>,
): Promise<ActionResult<{ recommendation: string; complete: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = saveAssessmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: {
        id: true,
        state: true,
        organisationId: true,
        assessment: true,
        serviceItem: { select: { checkSets: true } },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    if (!ASSESSMENT_EDIT_STATES.includes(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    // Keep only verdicts/notes whose item codes exist in the service checklist.
    const checkSets = parseCheckSets(request.serviceItem.checkSets);
    if (!hasCheckItems(checkSets)) {
      return { ok: false, error: "NO_CHECKLIST" };
    }
    const known = new Set(
      checkSets.flatMap((s) => s.items.map((i) => i.code)),
    );

    const verdicts: Record<string, "COMPLIANT" | "NON_COMPLIANT" | "NA"> = {};
    for (const [code, v] of Object.entries(parsed.data.verdicts)) {
      if (known.has(code)) verdicts[code] = v;
    }
    const notes: Record<string, string> = {};
    for (const [code, n] of Object.entries(parsed.data.notes ?? {})) {
      if (known.has(code) && n.trim()) notes[code] = n.trim();
    }

    const nextState: AssessmentState = {
      verdicts,
      notes,
      updatedAt: new Date().toISOString(),
      updatedByUserId: session.id,
    };
    const summary = computeAssessment(checkSets, nextState);

    await prisma.request.update({
      where: { id: request.id },
      data: { assessment: nextState as unknown as Prisma.InputJsonValue },
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.assessment.save",
      entityType: "Request",
      entityId: request.id,
      before: { assessment: request.assessment },
      after: {
        assessed: summary.assessed,
        total: summary.total,
        recommendation: summary.recommendation,
      },
    });

    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");
    return {
      ok: true,
      data: {
        recommendation: summary.recommendation,
        complete: summary.complete,
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

const clientFacingCommentSchema = z.object({
  requestId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

/** A request with no lifecycle history (DRAFT) or a dead one (CANCELLED) has no thread to message on. */
function canMessageOnRequestState(state: RequestState): boolean {
  return state !== "DRAFT" && state !== "CANCELLED";
}

export async function addAtlasClientComment(
  input: z.infer<typeof clientFacingCommentSchema>,
): Promise<ActionResult<{ commentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = clientFacingCommentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: {
        id: true,
        requestNo: true,
        organisationId: true,
        state: true,
        createdByUserId: true,
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
          direction: "ATLAS_TO_CLIENT",
          bodyEn: parsed.data.body,
          bodyAr: parsed.data.body,
        },
      });

      const { notify } = await import("@/server/notifications/notify");
      const { notificationCopy } = await import(
        "@/server/notifications/copy"
      );
      const copy = notificationCopy("COMMENT_ADDED_FROM_ATLAS", {
        requestNo: request.requestNo,
        message: parsed.data.body,
      });
      await notify(
        {
          event: "COMMENT_ADDED",
          data: {
            requestId: request.id,
            requestNo: request.requestNo,
            link: `/client/requests/${request.id}`,
            organisationId: request.organisationId,
            createdByUserId: request.createdByUserId,
            commentDirection: "ATLAS_TO_CLIENT",
            ...copy,
          },
        },
        tx,
      );

      return created;
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.comment.atlas",
      entityType: "RequestComment",
      entityId: comment.id,
      after: { requestId: request.id, direction: "ATLAS_TO_CLIENT" },
    });

    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");
    revalidatePath(`/[locale]/client/requests/${request.id}`, "page");

    return { ok: true, data: { commentId: comment.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const toggleServiceItemSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});

export async function toggleServiceItemActive(
  input: z.infer<typeof toggleServiceItemSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = toggleServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.serviceItem.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, active: true },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    await prisma.serviceItem.update({
      where: { id: item.id },
      data: { active: parsed.data.active },
    });

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.toggleActive",
      entityType: "ServiceItem",
      entityId: item.id,
      before: { active: item.active },
      after: { active: parsed.data.active },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateServiceItemSchema = z.object({
  id: z.string().min(1),
  subCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  basePrice: z.union([z.string(), z.number()]),
  vatRate: z.union([z.string(), z.number()]),
  slaHours: z.number().int().positive(),
  resubmissionPricePct: z.union([z.string(), z.number()]),
  freeResubmissions: z.number().int().min(0),
  maxResubmissions: z.number().int().min(0),
  sortOrder: z.number().int().min(0),
});

export type UpdateServiceItemInput = z.infer<typeof updateServiceItemSchema>;

export async function updateServiceItem(
  input: UpdateServiceItemInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const basePrice = parseMoneyInput(data.basePrice, { min: 0, max: 10_000_000 });
    if (!basePrice) return { ok: false, error: "VALIDATION" };
    const vatRate = parseMoneyInput(data.vatRate, { min: 0, max: 1 });
    if (!vatRate) return { ok: false, error: "VALIDATION" };
    const resubmissionPricePct = parseMoneyInput(data.resubmissionPricePct, {
      min: 0,
      max: 1,
    });
    if (!resubmissionPricePct) return { ok: false, error: "VALIDATION" };

    const existing = await prisma.serviceItem.findUnique({
      where: { id: data.id },
      select: {
        id: true,
        subCategoryId: true,
        code: true,
        basePrice: true,
        vatRate: true,
        slaHours: true,
        nameEn: true,
        nameAr: true,
        sortOrder: true,
      },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: data.subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.serviceItem.update({
        where: { id: existing.id },
        data: {
          subCategoryId: data.subCategoryId,
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          basePrice,
          vatRate,
          slaHours: data.slaHours,
          resubmissionPricePct,
          freeResubmissions: data.freeResubmissions,
          maxResubmissions: data.maxResubmissions,
          sortOrder: data.sortOrder,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.update",
      entityType: "ServiceItem",
      entityId: existing.id,
      before: {
        subCategoryId: existing.subCategoryId,
        code: existing.code,
        basePrice: existing.basePrice.toString(),
        vatRate: existing.vatRate.toString(),
        slaHours: existing.slaHours,
        nameEn: existing.nameEn,
        nameAr: existing.nameAr,
        sortOrder: existing.sortOrder,
      },
      after: {
        subCategoryId: data.subCategoryId,
        code: data.code,
        basePrice: basePrice.toString(),
        vatRate: vatRate.toString(),
        slaHours: data.slaHours,
        nameEn: data.nameEn,
        nameAr: data.nameAr,
        sortOrder: data.sortOrder,
      },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteServiceItemSchema = z.object({
  id: z.string().min(1),
});

export async function deleteServiceItem(
  input: z.infer<typeof deleteServiceItemSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.serviceItem.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    const requestCount = await prisma.request.count({
      where: { serviceItemId: item.id },
    });
    if (requestCount > 0) return { ok: false, error: "HAS_REQUESTS" };

    await prisma.serviceItem.delete({ where: { id: item.id } });

    await writeAuditLog({
      session,
      action: "catalogue.serviceItem.delete",
      entityType: "ServiceItem",
      entityId: item.id,
      before: { code: item.code, nameEn: item.nameEn, nameAr: item.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const requiredDocumentInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(200),
  nameAr: z.string().trim().min(1).max(200),
  mandatory: z.boolean(),
  acceptedMimeTypes: z.array(z.string().trim().min(1)).min(1),
  maxSizeMb: z.number().int().positive().max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const productAttrFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(["string", "number", "boolean"]),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
  required: z.boolean().optional(),
});

const checkSetInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  titleEn: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200),
});

const createServiceItemSchema = z.object({
  subCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  basePrice: z.union([z.string(), z.number()]),
  slaHours: z.number().int().positive(),
  vatRate: z.union([z.string(), z.number()]).optional(),
  resubmissionPricePct: z.union([z.string(), z.number()]).optional(),
  freeResubmissions: z.number().int().min(0).optional(),
  maxResubmissions: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  productAttributes: z.array(productAttrFieldSchema).optional(),
  checkSets: z.array(checkSetInputSchema).optional(),
  requiredDocuments: z.array(requiredDocumentInputSchema),
});

export async function createServiceItem(
  input: z.infer<typeof createServiceItemSchema>,
): Promise<ActionResult<{ serviceItemId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createServiceItemSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const basePrice = parseMoneyInput(data.basePrice, { min: 0, max: 10_000_000 });
    if (!basePrice) return { ok: false, error: "VALIDATION" };
    const vatRate =
      data.vatRate === undefined
        ? new Prisma.Decimal("0.15")
        : parseMoneyInput(data.vatRate, { min: 0, max: 1 });
    if (!vatRate) return { ok: false, error: "VALIDATION" };
    const resubmissionPricePct =
      data.resubmissionPricePct === undefined
        ? new Prisma.Decimal("0.5")
        : parseMoneyInput(data.resubmissionPricePct, { min: 0, max: 1 });
    if (!resubmissionPricePct) return { ok: false, error: "VALIDATION" };

    const subCategory = await prisma.subCategory.findUnique({
      where: { id: data.subCategoryId },
      select: { id: true },
    });
    if (!subCategory) return { ok: false, error: "NOT_FOUND" };

    const productAttributes = data.productAttributes ?? [];
    const checkSets = data.checkSets ?? [];
    const productAttrSchema: Prisma.InputJsonValue =
      productAttributes.length === 0
        ? {}
        : {
            type: "object",
            properties: Object.fromEntries(
              productAttributes.map((field) => [
                field.key,
                {
                  type: field.type,
                  titleEn: field.titleEn,
                  titleAr: field.titleAr,
                },
              ]),
            ),
            required: productAttributes
              .filter((field) => field.required)
              .map((field) => field.key),
          };

    let serviceItemId: string;
    try {
      serviceItemId = await prisma.$transaction(async (tx) => {
        const item = await tx.serviceItem.create({
          data: {
            subCategoryId: data.subCategoryId,
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            basePrice,
            vatRate,
            resubmissionPricePct,
            slaHours: data.slaHours,
            freeResubmissions: data.freeResubmissions ?? 0,
            maxResubmissions: data.maxResubmissions ?? 3,
            productAttrSchema,
            checkSets,
            sortOrder: data.sortOrder ?? 0,
            active: data.active ?? true,
          },
        });

        if (data.requiredDocuments.length > 0) {
          await tx.requiredDocument.createMany({
            data: data.requiredDocuments.map((doc, index) => ({
              serviceItemId: item.id,
              code: doc.code,
              nameEn: doc.nameEn,
              nameAr: doc.nameAr,
              mandatory: doc.mandatory,
              acceptedMimeTypes: doc.acceptedMimeTypes,
              maxSizeMb: doc.maxSizeMb ?? 50,
              sortOrder: doc.sortOrder ?? index,
            })),
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.serviceItem.create",
            entityType: "ServiceItem",
            entityId: item.id,
            after: {
              code: item.code,
              nameEn: item.nameEn,
              nameAr: item.nameAr,
              subCategoryId: item.subCategoryId,
              requiredDocumentCount: data.requiredDocuments.length,
              productAttributeCount: productAttributes.length,
              checkSetCount: checkSets.length,
            },
          },
        });

        return item.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { serviceItemId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createMainCategorySchema = z.object({
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates a top-level catalogue category. Code is globally unique. */
export async function createMainCategory(
  input: z.infer<typeof createMainCategorySchema>,
): Promise<ActionResult<{ mainCategoryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    let mainCategoryId: string;
    try {
      mainCategoryId = await prisma.$transaction(async (tx) => {
        const category = await tx.mainCategory.create({
          data: {
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            sortOrder: data.sortOrder ?? 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.mainCategory.create",
            entityType: "MainCategory",
            entityId: category.id,
            after: { code: category.code, nameEn: category.nameEn },
          },
        });
        return category.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { mainCategoryId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createSubCategorySchema = z.object({
  mainCategoryId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Creates a subcategory under a main category. Code is unique per parent. */
export async function createSubCategory(
  input: z.infer<typeof createSubCategorySchema>,
): Promise<ActionResult<{ subCategoryId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = createSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const main = await prisma.mainCategory.findUnique({
      where: { id: data.mainCategoryId },
      select: { id: true },
    });
    if (!main) return { ok: false, error: "NOT_FOUND" };

    let subCategoryId: string;
    try {
      subCategoryId = await prisma.$transaction(async (tx) => {
        const sub = await tx.subCategory.create({
          data: {
            mainCategoryId: data.mainCategoryId,
            code: data.code,
            nameEn: data.nameEn,
            nameAr: data.nameAr,
            descEn: data.descEn || null,
            descAr: data.descAr || null,
            sortOrder: data.sortOrder ?? 0,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            action: "catalogue.subCategory.create",
            entityType: "SubCategory",
            entityId: sub.id,
            after: {
              code: sub.code,
              nameEn: sub.nameEn,
              mainCategoryId: sub.mainCategoryId,
            },
          },
        });
        return sub.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { subCategoryId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateMainCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates a top-level catalogue category. Code is globally unique. */
export async function updateMainCategory(
  input: z.infer<typeof updateMainCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.mainCategory.findUnique({
      where: { id: data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.mainCategory.update({
        where: { id: existing.id },
        data: {
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.mainCategory.update",
      entityType: "MainCategory",
      entityId: existing.id,
      before: { code: existing.code, nameEn: existing.nameEn, nameAr: existing.nameAr },
      after: { code: data.code, nameEn: data.nameEn, nameAr: data.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteMainCategorySchema = z.object({
  id: z.string().min(1),
});

/**
 * Deletes a main category. Blocked (not cascaded) if it still has any
 * subcategories — those must be deleted first, which itself is blocked while
 * they hold service items. Keeps catalogue teardown an explicit, auditable
 * two-step process instead of a silent cascade.
 */
export async function deleteMainCategory(
  input: z.infer<typeof deleteMainCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteMainCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const category = await prisma.mainCategory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!category) return { ok: false, error: "NOT_FOUND" };

    const subCategoryCount = await prisma.subCategory.count({
      where: { mainCategoryId: category.id },
    });
    if (subCategoryCount > 0) return { ok: false, error: "HAS_SUBCATEGORIES" };

    await prisma.mainCategory.delete({ where: { id: category.id } });

    await writeAuditLog({
      session,
      action: "catalogue.mainCategory.delete",
      entityType: "MainCategory",
      entityId: category.id,
      before: { code: category.code, nameEn: category.nameEn, nameAr: category.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateSubCategorySchema = z.object({
  id: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  descEn: z.string().trim().max(2000).optional(),
  descAr: z.string().trim().max(2000).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Renames/updates a subcategory. Code is unique per parent main category. */
export async function updateSubCategory(
  input: z.infer<typeof updateSubCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = updateSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const data = parsed.data;

    const existing = await prisma.subCategory.findUnique({
      where: { id: data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    try {
      await prisma.subCategory.update({
        where: { id: existing.id },
        data: {
          code: data.code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          descEn: data.descEn || null,
          descAr: data.descAr || null,
          sortOrder: data.sortOrder ?? 0,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "catalogue.subCategory.update",
      entityType: "SubCategory",
      entityId: existing.id,
      before: { code: existing.code, nameEn: existing.nameEn, nameAr: existing.nameAr },
      after: { code: data.code, nameEn: data.nameEn, nameAr: data.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const deleteSubCategorySchema = z.object({
  id: z.string().min(1),
});

/** Deletes a subcategory. Blocked (not cascaded) if it still has service items. */
export async function deleteSubCategory(
  input: z.infer<typeof deleteSubCategorySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = deleteSubCategorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const sub = await prisma.subCategory.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, code: true, nameEn: true, nameAr: true },
    });
    if (!sub) return { ok: false, error: "NOT_FOUND" };

    const serviceItemCount = await prisma.serviceItem.count({
      where: { subCategoryId: sub.id },
    });
    if (serviceItemCount > 0) return { ok: false, error: "HAS_SERVICE_ITEMS" };

    await prisma.subCategory.delete({ where: { id: sub.id } });

    await writeAuditLog({
      session,
      action: "catalogue.subCategory.delete",
      entityType: "SubCategory",
      entityId: sub.id,
      before: { code: sub.code, nameEn: sub.nameEn, nameAr: sub.nameAr },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const setCouponStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED"]),
});

export async function setCouponStatus(
  input: z.infer<typeof setCouponStatusSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");
    const parsed = setCouponStatusSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const coupon = await prisma.coupon.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, status: true },
    });
    if (!coupon) return { ok: false, error: "NOT_FOUND" };

    await prisma.coupon.update({
      where: { id: coupon.id },
      data: { status: parsed.data.status },
    });

    await writeAuditLog({
      session,
      action: "coupon.status.set",
      entityType: "Coupon",
      entityId: coupon.id,
      before: { status: coupon.status },
      after: { status: parsed.data.status },
    });

    revalidatePath("/[locale]/admin/coupons", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const createCouponSchema = z
  .object({
    code: z.string().trim().min(2).max(40),
    nameEn: z.string().trim().min(2).max(200),
    nameAr: z.string().trim().min(2).max(200),
    discountType: z.enum(["PERCENT", "FIXED"]),
    value: z.union([z.string(), z.number()]),
    maxDiscountAmount: z.union([z.string(), z.number()]).optional(),
    minOrderAmount: z.union([z.string(), z.number()]).optional(),
    appliesTo: z
      .enum(["ALL", "MAIN_CATEGORY", "SUB_CATEGORY", "SERVICE_ITEM"])
      .optional(),
    appliesToIds: z.array(z.string().min(1)).optional(),
    clientScope: z.enum(["ALL", "SPECIFIC", "NEW_CLIENTS_ONLY"]).optional(),
    clientIds: z.array(z.string().min(1)).optional(),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date(),
    totalUsageLimit: z.number().int().positive().optional(),
    perClientLimit: z.number().int().positive().optional(),
    stackable: z.boolean().optional(),
    excludesResubmissions: z.boolean().optional(),
  })
  .refine((data) => data.validTo > data.validFrom, {
    message: "INVALID_DATE_RANGE",
    path: ["validTo"],
  });

export async function createCoupon(
  input: z.infer<typeof createCouponSchema>,
): Promise<ActionResult<{ couponId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");
    const parsed = createCouponSchema.safeParse(input);
    if (!parsed.success) {
      const dateRangeError = parsed.error.issues.some(
        (issue) => issue.message === "INVALID_DATE_RANGE",
      );
      return {
        ok: false,
        error: dateRangeError ? "INVALID_DATE_RANGE" : "VALIDATION",
      };
    }
    const data = parsed.data;

    let value: Prisma.Decimal;
    if (data.discountType === "PERCENT") {
      const raw = parseMoneyInput(data.value, { min: 0.01, max: 100 });
      if (!raw) return { ok: false, error: "VALIDATION" };
      const pct = parsePercentCouponValue(raw);
      if (!pct) return { ok: false, error: "VALIDATION" };
      value = pct;
    } else {
      const fixed = parseMoneyInput(data.value, { min: 0.01, max: 10_000_000 });
      if (!fixed) return { ok: false, error: "VALIDATION" };
      value = fixed;
    }
    const maxDiscountAmount =
      data.maxDiscountAmount === undefined
        ? null
        : parseMoneyInput(data.maxDiscountAmount, { min: 0.01, max: 10_000_000 });
    if (data.maxDiscountAmount !== undefined && !maxDiscountAmount) {
      return { ok: false, error: "VALIDATION" };
    }
    const minOrderAmount =
      data.minOrderAmount === undefined
        ? null
        : parseMoneyInput(data.minOrderAmount, { min: 0.01, max: 10_000_000 });
    if (data.minOrderAmount !== undefined && !minOrderAmount) {
      return { ok: false, error: "VALIDATION" };
    }

    const code = data.code.toUpperCase();

    let couponId: string;
    try {
      const coupon = await prisma.coupon.create({
        data: {
          code,
          nameEn: data.nameEn,
          nameAr: data.nameAr,
          discountType: data.discountType,
          value,
          maxDiscountAmount,
          minOrderAmount,
          appliesTo: data.appliesTo ?? "ALL",
          appliesToIds: data.appliesToIds ?? [],
          clientScope: data.clientScope ?? "ALL",
          clientIds: data.clientIds ?? [],
          validFrom: data.validFrom,
          validTo: data.validTo,
          totalUsageLimit: data.totalUsageLimit ?? null,
          perClientLimit: data.perClientLimit ?? null,
          stackable: data.stackable ?? false,
          excludesResubmissions: data.excludesResubmissions ?? true,
          status: "ACTIVE",
          createdByUserId: session.id,
        },
      });
      couponId = coupon.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return { ok: false, error: "CODE_TAKEN" };
      }
      throw error;
    }

    await writeAuditLog({
      session,
      action: "coupon.create",
      entityType: "Coupon",
      entityId: couponId,
      after: {
        code,
        nameEn: data.nameEn,
        discountType: data.discountType,
        value: value.toFixed(2),
      },
    });

    revalidatePath("/[locale]/admin/coupons", "page");
    return { ok: true, data: { couponId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const updateAtlasOrgSchema = z.object({
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  email: z.email(),
  phone: z.string().trim().max(30).nullable().optional(),
});

export async function updateAtlasOrganisation(
  input: z.infer<typeof updateAtlasOrgSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");
    const parsed = updateAtlasOrgSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const atlas = await prisma.organisation.findFirst({
      where: { type: "ATLAS" },
    });
    if (!atlas) return { ok: false, error: "NOT_FOUND" };

    const before = {
      nameEn: atlas.nameEn,
      nameAr: atlas.nameAr,
      email: atlas.email,
      phone: atlas.phone,
    };

    await prisma.organisation.update({
      where: { id: atlas.id },
      data: {
        nameEn: parsed.data.nameEn,
        nameAr: parsed.data.nameAr,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
      },
    });

    await writeAuditLog({
      session,
      action: "organisation.atlas.update",
      entityType: "Organisation",
      entityId: atlas.id,
      before,
      after: parsed.data,
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function inviteAtlasStaff(
  input: InviteAtlasStaffInput,
): Promise<ActionResult<{ userId: string; emailed: true }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = inviteAtlasStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) return { ok: false, error: "EMAIL_UNAVAILABLE" };

    const atlasOrgId =
      session.organisation.type === "ATLAS"
        ? session.organisationId
        : (await prisma.organisation.findFirst({ where: { type: "ATLAS" } }))
            ?.id;
    if (!atlasOrgId) return { ok: false, error: "NOT_FOUND" };

    const temporaryPassword = randomBytes(9).toString("base64url");
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    const usernameBase = parsed.data.email
      .split("@")[0]
      ?.replace(/[^a-zA-Z0-9._-]/g, ".")
      .slice(0, 40);
    const username = `${usernameBase}.${Date.now().toString(36)}`;

    const user = await prisma.user.create({
      data: {
        organisationId: atlasOrgId,
        email: parsed.data.email,
        username,
        passwordHash,
        fullNameEn: parsed.data.fullNameEn,
        fullNameAr: parsed.data.fullNameAr,
        locale: "ar",
        status: "ACTIVE",
        // Created by an authenticated admin — treated as a trusted invite.
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: parsed.data.role }] },
      },
    });

    const adapter = getEmailAdapter();
    await adapter.send({
      to: user.email,
      subject: "Atlas RCP — staff invite / دعوة موظف",
      text: `Your temporary password is: ${temporaryPassword}\n\nكلمة المرور المؤقتة: ${temporaryPassword}`,
      html: `<p>Your temporary password is: <code>${temporaryPassword}</code></p><p dir="rtl">كلمة المرور المؤقتة: <code>${temporaryPassword}</code></p>`,
    });

    await writeAuditLog({
      session,
      action: "staff.invite",
      entityType: "User",
      entityId: user.id,
      after: {
        email: user.email,
        role: parsed.data.role,
        organisationId: atlasOrgId,
        emailed: true,
      },
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return {
      ok: true,
      data: { userId: user.id, emailed: true },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function updateAtlasStaffRole(
  input: UpdateAtlasStaffRoleInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = updateAtlasStaffRoleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisation: { type: "ATLAS" } },
      include: { roles: true },
    });
    if (!target) return { ok: false, error: "NOT_FOUND" };

    const wasAdmin = target.roles.some((r) => r.role === "SYSTEM_ADMIN");
    if (wasAdmin && parsed.data.role !== "SYSTEM_ADMIN") {
      const activeAdminCount = await prisma.user.count({
        where: {
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "SYSTEM_ADMIN" } },
        },
      });
      if (activeAdminCount <= 1) {
        return { ok: false, error: "LAST_ADMIN" };
      }
    }

    const beforeRoles = target.roles.map((r) => r.role);
    await prisma.$transaction([
      prisma.userRole.deleteMany({ where: { userId: target.id } }),
      prisma.userRole.create({
        data: { userId: target.id, role: parsed.data.role },
      }),
    ]);

    await writeAuditLog({
      session,
      action: "staff.role.change",
      entityType: "User",
      entityId: target.id,
      before: { roles: beforeRoles },
      after: { roles: [parsed.data.role] },
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

export async function deactivateAtlasStaff(
  input: DeactivateAtlasStaffInput,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "staff:manage");
    const parsed = deactivateAtlasStaffSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    if (parsed.data.userId === session.id) {
      return { ok: false, error: "CANNOT_DEACTIVATE_SELF" };
    }

    const target = await prisma.user.findFirst({
      where: { id: parsed.data.userId, organisation: { type: "ATLAS" } },
      include: { roles: true },
    });
    if (!target) return { ok: false, error: "NOT_FOUND" };

    if (target.roles.some((r) => r.role === "SYSTEM_ADMIN")) {
      const activeAdminCount = await prisma.user.count({
        where: {
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "SYSTEM_ADMIN" } },
        },
      });
      if (activeAdminCount <= 1) {
        return { ok: false, error: "LAST_ADMIN" };
      }
    }

    await prisma.user.update({
      where: { id: target.id },
      data: { status: "DISABLED" },
    });

    await writeAuditLog({
      session,
      action: "staff.deactivate",
      entityType: "User",
      entityId: target.id,
      before: { status: target.status },
      after: { status: "DISABLED" },
    });

    revalidatePath("/[locale]/admin/settings", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

/** Derive a unique, URL-safe username from the email local part. */
async function uniqueClientUsername(email: string): Promise<string> {
  const base =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9._-]/g, "")
      .slice(0, 24) || "user";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const taken = await prisma.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Admin-side client onboarding: creates a client organisation and its owner
 * user in one transaction. The account is ACTIVE with the email pre-verified,
 * so the owner can sign in immediately with the initial password the admin set.
 */
export async function createClientAction(
  input: CreateClientInput,
): Promise<ActionResult<{ organisationId: string; email: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "clients:create");

    const parsed = createClientSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const known = ["INVALID_SAUDI_PHONE", "WEAK_PASSWORD"];
      const code =
        issue && known.includes(issue.message) ? issue.message : "VALIDATION";
      return { ok: false, error: code };
    }

    const data = parsed.data;
    const email = data.email.toLowerCase();
    const phone = data.phone ? data.phone.trim() || null : null;

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) return { ok: false, error: "EMAIL_TAKEN" };

    const username = await uniqueClientUsername(email);
    const passwordHash = await bcrypt.hash(data.password, 12);

    let organisationId: string;
    try {
      organisationId = await prisma.$transaction(async (tx) => {
        const organisation = await tx.organisation.create({
          data: {
            type: "CLIENT",
            clientCategory: "COMPANY",
            nameEn: data.companyNameEn,
            nameAr: data.companyNameAr,
            email,
            phone,
            status: "ACTIVE",
          },
        });

        const user = await tx.user.create({
          data: {
            organisationId: organisation.id,
            email,
            username,
            passwordHash,
            fullNameEn: data.fullNameEn,
            fullNameAr: data.fullNameAr,
            phone,
            locale: data.locale,
            status: "ACTIVE",
            // Admin-created accounts are trusted: verified so login is allowed.
            emailVerifiedAt: new Date(),
            roles: { create: [{ role: "CLIENT_OWNER" }] },
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: session.id,
            actorRole: session.roles[0],
            organisationId: organisation.id,
            action: "admin.client.create",
            entityType: "Organisation",
            entityId: organisation.id,
            after: {
              organisationNameEn: organisation.nameEn,
              ownerEmail: email,
              ownerUserId: user.id,
            },
          },
        });

        return organisation.id;
      });
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: string }).code)
          : "";
      if (code === "P2002") return { ok: false, error: "EMAIL_TAKEN" };
      return { ok: false, error: "SAVE_FAILED" };
    }

    revalidatePath("/[locale]/admin/clients", "page");
    return { ok: true, data: { organisationId, email } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
