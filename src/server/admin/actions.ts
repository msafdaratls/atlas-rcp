"use server";

import { randomBytes } from "node:crypto";
import { Prisma, type RequestState } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { sendInviteEmail } from "@/lib/auth/auth-email";
import { issueVerificationToken } from "@/lib/auth/tokens";
import {
  computeAssessment,
  hasCheckItems,
  parseAssessment,
  parseCheckSets,
  type AssessmentState,
} from "@/lib/assessment";
import { writeAuditLog, requestMeta } from "@/lib/audit";
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
import {
  allowedTransitionsFor,
  canReopenRequest,
  NEW_REQUEST_STATES,
  onHoldResumeTarget,
  REOPEN_TARGET_STATES,
} from "@/server/admin/queries";
import { appendReversingEntry } from "@/server/finance/ledger";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Lightweight, pollable count of not-yet-started requests, used by the admin
 * sidebar to keep the "Requests" badge fresh between navigations.
 */
export async function getNewRequestsCount(): Promise<number> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    return await prisma.request.count({
      where: { state: { in: NEW_REQUEST_STATES } },
    });
  } catch {
    return 0;
  }
}

/** Entering these states with no reviewer yet auto-assigns the acting user. */
const REVIEW_ASSIGNMENT_STATES: RequestState[] = [
  "UNDER_INTAKE_REVIEW",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
];

type StateNotificationEvent =
  | "REQUEST_RETURNED"
  | "REQUEST_ACCEPTED"
  | "CERTIFICATE_GRANTED"
  | "REPORT_ISSUED"
  | "TECHNICAL_REVIEW_READY"
  | "DECISION_READY"
  | "REQUEST_CLOSED"
  | "CERTIFICATE_REFUSED";

function notificationEventForState(
  fromState: RequestState,
  toState: RequestState,
): StateNotificationEvent | null {
  if (toState === "RETURNED_TO_CLIENT") return "REQUEST_RETURNED";
  if (toState === "ACCEPTED") return "REQUEST_ACCEPTED";
  // Grant hands the request to the Evaluator to fetch/upload the real
  // external certificate — the customer isn't told yet (see below, fired
  // only once REPORT_ISSUED -> CLOSED actually completes issuance).
  if (fromState === "DECISION" && toState === "REPORT_ISSUED") {
    return "CERTIFICATE_GRANTED";
  }
  if (toState === "TECHNICAL_REVIEW") return "TECHNICAL_REVIEW_READY";
  if (toState === "DECISION") return "DECISION_READY";
  if (toState === "CLOSED") {
    // Refusal (DECISION -> CLOSED) and completed issuance (REPORT_ISSUED ->
    // CLOSED) are the only two routes to CLOSED; each notifies differently.
    if (fromState === "DECISION") return "CERTIFICATE_REFUSED";
    if (fromState === "REPORT_ISSUED") return "REPORT_ISSUED";
    return "REQUEST_CLOSED";
  }
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
  reasonCodes: z.array(z.enum(RETURN_REASON_CODES)).max(RETURN_REASON_CODES.length).optional(),
  faultAttribution: z.enum(FAULT_ATTRIBUTIONS).optional(),
  /** Required on the three Conflict-of-Interest-gated transitions; see COI_GATED_TRANSITIONS. */
  coiAcknowledged: z.literal(true).optional(),
});

/**
 * Transitions the spec requires a mandatory Conflict of Interest Declaration
 * before: completing Evaluation, completing Technical Review, and saving a
 * Certification Decision (both Grant and Refuse).
 */
const COI_GATED_TRANSITIONS: Array<[RequestState, RequestState]> = [
  ["ASSESSMENT_RUNNING", "TECHNICAL_REVIEW"],
  ["TECHNICAL_REVIEW", "DECISION"],
  ["DECISION", "REPORT_ISSUED"],
  ["DECISION", "CLOSED"],
];

export async function transitionAdminRequest(
  input: z.infer<typeof transitionSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = transitionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const { requestId, toState, note, faultAttribution, coiAcknowledged } =
      parsed.data;
    const reasonCodes = [...new Set(parsed.data.reasonCodes ?? [])];

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        createdBy: { select: { id: true } },
        organisation: { select: { nameEn: true, nameAr: true } },
        items: {
          take: 1,
          orderBy: { sortOrder: "asc" },
          select: { serviceItem: { select: { nameEn: true, nameAr: true } } },
        },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    const serviceNameEn = request.items[0]?.serviceItem.nameEn ?? "";
    const serviceNameAr = request.items[0]?.serviceItem.nameAr ?? "";

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

    if (toState === "RETURNED_TO_CLIENT" && (reasonCodes.length === 0 || !faultAttribution)) {
      return { ok: false, error: "RETURN_REASON_REQUIRED" };
    }

    if (toState === "CANCELLED" && !note) {
      return { ok: false, error: "CANCEL_NOTE_REQUIRED" };
    }

    // Refusing certification (DECISION -> CLOSED) must carry a reason, same
    // rule as CANCELLED — this is the "Refuse Certification" path.
    if (request.state === "DECISION" && toState === "CLOSED" && !note) {
      return { ok: false, error: "REFUSAL_REASON_REQUIRED" };
    }

    if (
      COI_GATED_TRANSITIONS.some(
        ([from, to]) => from === request.state && to === toState,
      ) &&
      !coiAcknowledged
    ) {
      return { ok: false, error: "COI_ACKNOWLEDGEMENT_REQUIRED" };
    }

    if (
      request.state === "ASSESSMENT_RUNNING" &&
      toState === "TECHNICAL_REVIEW" &&
      !(await hasEvaluationReportForAllItems(request.id))
    ) {
      return { ok: false, error: "EVALUATION_REPORT_REQUIRED" };
    }

    // "Complete Certificate Issuance": if the request has any EXTERNAL_CERTIFICATE
    // item (e.g. SCOC), the Evaluator cannot close it until the real certificate
    // obtained from SABER/SFDA is attached to at least one ExternalDeliverable on
    // the request — same CERTIFICATE_REQUIRED check markExternalDeliverableIssued
    // uses to mark a single deliverable ISSUED, applied here at the request level
    // since not every item needs its own certificate (e.g. a request with one
    // certified item and one internal-only item). Requests with no
    // EXTERNAL_CERTIFICATE item (e.g. PCOC-only) skip this entirely.
    if (request.state === "REPORT_ISSUED" && toState === "CLOSED") {
      const certificateItemCount = await prisma.requestItem.count({
        where: {
          requestId: request.id,
          serviceItem: { deliverableType: "EXTERNAL_CERTIFICATE" },
        },
      });
      if (certificateItemCount > 0) {
        const docCount = await prisma.requestDocument.count({
          where: {
            requestItem: { requestId: request.id },
            externalDeliverableId: { not: null },
            currentVersionId: { not: null },
          },
        });
        if (docCount === 0) {
          return { ok: false, error: "CERTIFICATE_REQUIRED" };
        }
      }
    }

    if (request.state === "TECHNICAL_REVIEW" && toState === "DECISION") {
      const [definition, requestChecklist] = await Promise.all([
        prisma.technicalReviewChecklist.findUnique({ where: { id: "singleton" } }),
        prisma.request.findUnique({
          where: { id: request.id },
          select: { technicalReviewChecklist: true },
        }),
      ]);
      const checkSets = parseCheckSets(definition?.checkSets);
      if (hasCheckItems(checkSets)) {
        const state = parseAssessment(requestChecklist?.technicalReviewChecklist);
        if (!computeAssessment(checkSets, state).complete) {
          return { ok: false, error: "TECHNICAL_REVIEW_CHECKLIST_INCOMPLETE" };
        }
      }
    }

    const now = new Date();
    const closedAt =
      toState === "CLOSED" ? now : toState === "REPORT_ISSUED" ? null : undefined;
    const assignedToUserId =
      // Grant is a hand-off, not a self-assign: clear the Decision Maker's
      // assignment so the request enters the Evaluator queue unassigned,
      // ready for an Evaluator to pick up and complete certificate issuance.
      request.state === "DECISION" && toState === "REPORT_ISSUED"
        ? null
        : request.assignedToUserId === null &&
            REVIEW_ASSIGNMENT_STATES.includes(toState)
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

      const eventMetadata: Record<string, unknown> = {};
      if (request.state === "DECISION" && (toState === "REPORT_ISSUED" || toState === "CLOSED")) {
        eventMetadata.decision = toState === "REPORT_ISSUED" ? "GRANTED" : "REFUSED";
      }
      if (coiAcknowledged) {
        eventMetadata.coiAcknowledged = true;
        eventMetadata.coiAcknowledgedAt = now.toISOString();
      }

      await tx.requestEvent.create({
        data: {
          requestId,
          fromState: request.state,
          toState,
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
          note: note ?? null,
          reasonCodes,
          faultAttribution: faultAttribution ?? null,
          metadata: eventMetadata as Prisma.InputJsonValue,
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
            reasonCodes,
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
            customerNameEn: request.organisation.nameEn,
            customerNameAr: request.organisation.nameAr,
            serviceNameEn,
            serviceNameAr,
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

        const eventType = notificationEventForState(request.state, toState);
        if (eventType && request.createdBy) {
          const copy = notificationCopy(eventType, {
            requestNo: request.requestNo,
            customerNameEn: request.organisation.nameEn,
            customerNameAr: request.organisation.nameAr,
            serviceNameEn,
            serviceNameAr,
            ...(eventType === "CERTIFICATE_REFUSED" ? { reason: note ?? "" } : {}),
          });
          await notify(
            {
              event: eventType,
              data: {
                requestId,
                requestNo: request.requestNo,
                state: toState,
                link:
                  eventType === "TECHNICAL_REVIEW_READY" ||
                  eventType === "DECISION_READY" ||
                  eventType === "CERTIFICATE_GRANTED"
                    ? `/admin/requests/${requestId}`
                    : `/client/requests/${requestId}`,
                organisationId: request.organisationId,
                createdByUserId: request.createdBy.id,
                ...copy,
              },
            },
            tx,
          );

          // A refusal is also a closure — notify the customer of the closure
          // itself, in addition to CERTIFICATE_REFUSED going to intake staff.
          if (eventType === "CERTIFICATE_REFUSED") {
            const closedCopy = notificationCopy("REQUEST_CLOSED", {
              requestNo: request.requestNo,
              serviceNameEn,
              serviceNameAr,
            });
            await notify(
              {
                event: "REQUEST_CLOSED",
                data: {
                  requestId,
                  requestNo: request.requestNo,
                  state: toState,
                  link: `/client/requests/${requestId}`,
                  organisationId: request.organisationId,
                  createdByUserId: request.createdBy.id,
                  ...closedCopy,
                },
              },
              tx,
            );
          }
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

const completeApplicationReviewSchema = z.object({
  requestId: z.string().min(1),
});

/**
 * "Complete Application Review": the spec requires this to automatically
 * move the request to Evaluation and assign the appropriate Evaluator based
 * on service type, in one action — not three separate manual clicks through
 * ACCEPTED / ASSESSMENT_QUEUED / ASSESSMENT_RUNNING. This cascades through
 * those states in a single transaction (each still recorded as its own
 * RequestEvent for audit trail) and routes to ServiceItem.defaultEvaluatorId.
 */
export async function completeApplicationReview(
  input: z.infer<typeof completeApplicationReviewSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeApplicationReviewSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestId } = parsed.data;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        createdBy: { select: { id: true } },
        organisation: { select: { nameEn: true, nameAr: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            serviceItem: {
              select: {
                nameEn: true,
                nameAr: true,
                defaultEvaluatorId: true,
                defaultEvaluator: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    if (request.state !== "UNDER_INTAKE_REVIEW") {
      return { ok: false, error: "INVALID_TRANSITION" };
    }

    if (!canTransitionRequest(session, "ACCEPTED", { fromState: request.state })) {
      return { ok: false, error: "FORBIDDEN" };
    }

    const routedItem = request.items.find(
      (item) =>
        item.serviceItem.defaultEvaluatorId &&
        item.serviceItem.defaultEvaluator?.status === "ACTIVE",
    );
    const evaluatorId = routedItem?.serviceItem.defaultEvaluatorId ?? null;
    const serviceNameEn = request.items[0]?.serviceItem.nameEn ?? "";
    const serviceNameAr = request.items[0]?.serviceItem.nameAr ?? "";

    await prisma.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        where: { id: requestId, state: "UNDER_INTAKE_REVIEW" },
        data: { state: "ASSESSMENT_RUNNING", assignedToUserId: evaluatorId },
      });
      if (updated.count === 0) {
        throw new Error("CONFLICT");
      }

      const chain: Array<[RequestState, RequestState]> = [
        ["UNDER_INTAKE_REVIEW", "ACCEPTED"],
        ["ACCEPTED", "ASSESSMENT_QUEUED"],
        ["ASSESSMENT_QUEUED", "ASSESSMENT_RUNNING"],
      ];
      for (const [fromState, toState] of chain) {
        await tx.requestEvent.create({
          data: {
            requestId,
            fromState,
            toState,
            actorUserId: session.id,
            actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
            note:
              toState === "ASSESSMENT_RUNNING"
                ? evaluatorId
                  ? "Application review completed — auto-assigned to Evaluator by service type"
                  : "Application review completed — no default Evaluator configured for this service, left unassigned"
                : "Application review completed (auto-advanced)",
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action: "request.completeApplicationReview",
          entityType: "Request",
          entityId: requestId,
          before: { state: request.state, assignedToUserId: request.assignedToUserId },
          after: { state: "ASSESSMENT_RUNNING", assignedToUserId: evaluatorId },
        },
      });

      try {
        const { notify } = await import("@/server/notifications/notify");
        const { notificationCopy } = await import("@/server/notifications/copy");

        if (evaluatorId) {
          await notify(
            {
              event: "REQUEST_ASSIGNED",
              data: {
                requestId,
                requestNo: request.requestNo,
                state: "ASSESSMENT_RUNNING",
                link: `/admin/requests/${requestId}`,
                organisationId: request.organisationId,
                assignedToUserId: evaluatorId,
                ...notificationCopy("REQUEST_ASSIGNED", {
                  requestNo: request.requestNo,
                  customerNameEn: request.organisation.nameEn,
                  customerNameAr: request.organisation.nameAr,
                  serviceNameEn,
                  serviceNameAr,
                }),
              },
            },
            tx,
          );
        }

        if (request.createdBy) {
          await notify(
            {
              event: "REQUEST_ACCEPTED",
              data: {
                requestId,
                requestNo: request.requestNo,
                state: "ASSESSMENT_RUNNING",
                link: `/client/requests/${requestId}`,
                organisationId: request.organisationId,
                createdByUserId: request.createdBy.id,
                ...notificationCopy("REQUEST_ACCEPTED", {
                  requestNo: request.requestNo,
                }),
              },
            },
            tx,
          );
        }
      } catch (error) {
        log.error(
          "admin.requests.completeApplicationReview",
          "notification delivery failed",
          {
            requestId,
            error: error instanceof Error ? error.message : "unknown",
          },
        );
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

const REOPEN_TARGET_STATE_VALUES = [
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
] as const;

/** Fresh SLA clock for a request coming out of a terminal state (CLOSED/CANCELLED never leaves a resumable pause). */
function freshSlaDueAt(now: Date, slaHours: number): Date {
  return new Date(now.getTime() + slaHours * 60 * 60 * 1000);
}

async function notifyReopenDecided(
  tx: Prisma.TransactionClient,
  input: {
    approved: boolean;
    requestId: string;
    requestNo: string;
    organisationId: string;
    createdByUserId: string;
    decisionNote: string | null;
  },
): Promise<void> {
  try {
    const { notify } = await import("@/server/notifications/notify");
    const { notificationCopy } = await import("@/server/notifications/copy");
    const copy = notificationCopy(
      input.approved ? "REOPEN_DECIDED_APPROVED" : "REOPEN_DECIDED_REJECTED",
      { requestNo: input.requestNo, reason: input.decisionNote ?? "" },
    );
    await notify(
      {
        event: "REOPEN_DECIDED",
        data: {
          requestId: input.requestId,
          requestNo: input.requestNo,
          link: `/client/requests/${input.requestId}`,
          organisationId: input.organisationId,
          createdByUserId: input.createdByUserId,
          ...copy,
        },
      },
      tx,
    );
  } catch (error) {
    log.error("admin.requests.reopen", "notification delivery failed", {
      requestId: input.requestId,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

const decideReopenRequestSchema = z.object({
  reopenRequestId: z.string().min(1),
  decision: z.enum(["APPROVE", "REJECT"]),
  targetState: z.enum(REOPEN_TARGET_STATE_VALUES).optional(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Approves or rejects a client's pending request to reopen a CLOSED/CANCELLED
 * request. Approval requires an active destination stage and moves the
 * request there with a fresh SLA clock; rejection requires an explanation and
 * leaves the request untouched.
 */
export async function decideReopenRequest(
  input: z.infer<typeof decideReopenRequestSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = decideReopenRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { reopenRequestId, decision, targetState, note } = parsed.data;

    if (decision === "APPROVE" && !targetState) {
      return { ok: false, error: "TARGET_STATE_REQUIRED" };
    }
    if (decision === "REJECT" && !note) {
      return { ok: false, error: "REJECT_NOTE_REQUIRED" };
    }

    const reopenRequest = await prisma.requestReopenRequest.findUnique({
      where: { id: reopenRequestId },
    });
    if (!reopenRequest || reopenRequest.status !== "PENDING") {
      return { ok: false, error: "NOT_FOUND" };
    }
    const request = await prisma.request.findUnique({
      where: { id: reopenRequest.requestId },
      include: { items: { include: { serviceItem: { select: { slaHours: true } } } } },
    });
    if (!request) {
      return { ok: false, error: "NOT_FOUND" };
    }
    const requestSlaHours = Math.max(
      ...request.items.map((i) => i.serviceItem.slaHours),
    );
    if (!canReopenRequest(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (decision === "APPROVE" && !REOPEN_TARGET_STATES.includes(targetState!)) {
      return { ok: false, error: "INVALID_TARGET_STATE" };
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (decision === "REJECT") {
        await tx.requestReopenRequest.update({
          where: { id: reopenRequestId },
          data: {
            status: "REJECTED",
            decidedByUserId: session.id,
            decisionNote: note ?? null,
            decidedAt: now,
          },
        });
      } else {
        const updated = await tx.request.updateMany({
          where: { id: request.id, state: request.state },
          data: {
            state: targetState!,
            closedAt: null,
            heldFromState: null,
            slaPausedAt: null,
            slaDueAt: freshSlaDueAt(now, requestSlaHours),
          },
        });
        if (updated.count === 0) {
          throw new Error("CONFLICT");
        }

        await tx.requestEvent.create({
          data: {
            requestId: request.id,
            fromState: request.state,
            toState: targetState!,
            actorUserId: session.id,
            actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
            note: note ?? "Reopened after client request",
            metadata: { reopenRequestId },
          },
        });

        await tx.requestReopenRequest.update({
          where: { id: reopenRequestId },
          data: {
            status: "APPROVED",
            decidedByUserId: session.id,
            decisionNote: note ?? null,
            targetState: targetState!,
            decidedAt: now,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action:
            decision === "APPROVE" ? "request.reopen.approve" : "request.reopen.reject",
          entityType: "Request",
          entityId: request.id,
          before: { state: request.state },
          after: {
            reopenRequestId,
            decision,
            targetState: decision === "APPROVE" ? targetState : undefined,
            note,
          },
        },
      });

      await notifyReopenDecided(tx, {
        approved: decision === "APPROVE",
        requestId: request.id,
        requestNo: request.requestNo,
        organisationId: request.organisationId,
        createdByUserId: request.createdByUserId,
        decisionNote: note ?? null,
      });
    });

    revalidatePath("/[locale]/admin/requests", "page");
    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");
    revalidatePath(`/[locale]/client/requests/${request.id}`, "page");

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

const reopenRequestByAdminSchema = z.object({
  requestId: z.string().min(1),
  targetState: z.enum(REOPEN_TARGET_STATE_VALUES),
  reason: z.string().trim().min(10).max(1000),
});

/**
 * Direct admin override: reopens a CLOSED/CANCELLED request without waiting
 * on a client ask. Recorded as a self-approved `RequestReopenRequest` so the
 * override shows up in the same audit trail as client-initiated reopens.
 */
export async function reopenRequestByAdmin(
  input: z.infer<typeof reopenRequestByAdminSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = reopenRequestByAdminSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestId, targetState, reason } = parsed.data;

    if (!REOPEN_TARGET_STATES.includes(targetState)) {
      return { ok: false, error: "INVALID_TARGET_STATE" };
    }

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: { items: { include: { serviceItem: { select: { slaHours: true } } } } },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (!canReopenRequest(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    const requestSlaHours = Math.max(
      ...request.items.map((i) => i.serviceItem.slaHours),
    );

    const pending = await prisma.requestReopenRequest.findFirst({
      where: { requestId, status: "PENDING" },
      select: { id: true },
    });
    if (pending) return { ok: false, error: "PENDING_REQUEST_EXISTS" };

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        where: { id: requestId, state: request.state },
        data: {
          state: targetState,
          closedAt: null,
          heldFromState: null,
          slaPausedAt: null,
          slaDueAt: freshSlaDueAt(now, requestSlaHours),
        },
      });
      if (updated.count === 0) {
        throw new Error("CONFLICT");
      }

      const reopenRequest = await tx.requestReopenRequest.create({
        data: {
          requestId,
          status: "APPROVED",
          reason,
          requestedByUserId: session.id,
          decidedByUserId: session.id,
          decisionNote: reason,
          targetState,
          decidedAt: now,
        },
      });

      await tx.requestEvent.create({
        data: {
          requestId,
          fromState: request.state,
          toState: targetState,
          actorUserId: session.id,
          actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
          note: reason,
          metadata: { reopenRequestId: reopenRequest.id, adminInitiated: true },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action: "request.reopen.admin",
          entityType: "Request",
          entityId: requestId,
          before: { state: request.state },
          after: { targetState, reason },
        },
      });

      await notifyReopenDecided(tx, {
        approved: true,
        requestId,
        requestNo: request.requestNo,
        organisationId: request.organisationId,
        createdByUserId: request.createdByUserId,
        decisionNote: reason,
      });
    });

    revalidatePath("/[locale]/admin/requests", "page");
    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    revalidatePath(`/[locale]/client/requests/${requestId}`, "page");

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
        organisation: { select: { nameEn: true, nameAr: true } },
        items: {
          take: 1,
          orderBy: { sortOrder: "asc" },
          select: { serviceItem: { select: { nameEn: true, nameAr: true } } },
        },
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
            customerNameEn: request.organisation.nameEn,
            customerNameAr: request.organisation.nameAr,
            serviceNameEn: request.items[0]?.serviceItem.nameEn ?? "",
            serviceNameAr: request.items[0]?.serviceItem.nameAr ?? "",
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

/** Extract distinct mentioned user IDs from `@Full Name\u2063userId\u2063` tokens. */
function extractMentionedUserIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(/@[^\u2063\n]+\u2063([a-zA-Z0-9_-]+)\u2063/g)) {
    ids.add(match[1]);
  }
  return [...ids];
}

/** Log Notes attachments: same accept-list as generic document uploads, capped smaller since these are incidental evidence, not required submission documents. */
const COMMENT_ATTACHMENT_ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];
const COMMENT_ATTACHMENT_MAX_MB = 20;

export async function addAdminInternalComment(
  formData: FormData,
): Promise<ActionResult<{ commentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = internalCommentSchema.safeParse({
      requestId: String(formData.get("requestId") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: { id: true, requestNo: true, organisationId: true, state: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (!canMessageOnRequestState(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    let attachment: {
      fileName: string;
      storageKey: string;
      sizeBytes: number;
      mimeType: string;
    } | null = null;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      if (!COMMENT_ATTACHMENT_ACCEPTED.includes(file.type)) {
        return { ok: false, error: "MIME_REJECTED" };
      }
      if (file.size > COMMENT_ATTACHMENT_MAX_MB * 1024 * 1024) {
        return { ok: false, error: "FILE_TOO_LARGE" };
      }
      const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
      const { storage } = await import("@/lib/storage");
      const buffer = Buffer.from(await file.arrayBuffer());
      const sniffed = sniffMime(buffer);
      if (!mimeAllowed(sniffed, COMMENT_ATTACHMENT_ACCEPTED)) {
        return { ok: false, error: "MIME_REJECTED" };
      }
      const { getAvScanner } = await import("@/lib/av");
      const verdict = await getAvScanner().scan(buffer);
      if (verdict === "INFECTED") {
        return { ok: false, error: "INFECTED_FILE" };
      }
      const stored = await storage.put({
        keyPrefix: `orgs/${request.organisationId}/requests/${request.id}/notes`,
        fileName: file.name,
        mimeType: sniffed,
        body: buffer,
      });
      attachment = {
        fileName: file.name,
        storageKey: stored.key,
        sizeBytes: buffer.byteLength,
        mimeType: sniffed,
      };
    }

    const candidateIds = extractMentionedUserIds(parsed.data.body).filter(
      (id) => id !== session.id,
    );
    const mentionedUsers = candidateIds.length
      ? await prisma.user.findMany({
          where: {
            id: { in: candidateIds },
            status: "ACTIVE",
            organisation: { type: "ATLAS" },
          },
          select: { id: true },
        })
      : [];

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.requestComment.create({
        data: {
          requestId: request.id,
          authorUserId: session.id,
          direction: "INTERNAL",
          bodyEn: parsed.data.body,
          bodyAr: parsed.data.body,
          attachments: attachment ? [attachment as Prisma.InputJsonObject] : [],
        },
      });

      if (mentionedUsers.length > 0) {
        await tx.requestCommentMention.createMany({
          data: mentionedUsers.map((u) => ({
            commentId: created.id,
            userId: u.id,
          })),
        });

        const { notify } = await import("@/server/notifications/notify");
        const { notificationCopy } = await import(
          "@/server/notifications/copy"
        );
        const copy = notificationCopy("NOTE_MENTION", {
          requestNo: request.requestNo,
          authorName: session.fullNameEn,
        });
        await notify(
          {
            event: "NOTE_MENTION",
            recipients: mentionedUsers.map((u) => u.id),
            data: {
              requestId: request.id,
              requestNo: request.requestNo,
              link: `/admin/requests/${request.id}`,
              organisationId: request.organisationId,
              ...copy,
            },
          },
          tx,
        );
      }

      return created;
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
    if (message === "AV_UNAVAILABLE") {
      return { ok: false, error: "AV_UNAVAILABLE" };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

/**
 * States in which a reviewer may edit the item-level assessment. REPORT_ISSUED
 * is included so the Evaluator can submit/upload/mark-issued the real
 * external certificate during the post-Grant hand-off, before the final
 * REPORT_ISSUED -> CLOSED close (see markExternalDeliverableIssued's
 * CERTIFICATE_REQUIRED gate, reused there).
 */
const ASSESSMENT_EDIT_STATES: RequestState[] = [
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "REPORT_ISSUED",
];

const saveAssessmentSchema = z.object({
  requestItemId: z.string().min(1),
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

    const item = await prisma.requestItem.findUnique({
      where: { id: parsed.data.requestItemId },
      select: {
        id: true,
        assessment: true,
        serviceItem: { select: { checkSets: true } },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };

    if (!ASSESSMENT_EDIT_STATES.includes(item.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    // Keep only verdicts/notes whose item codes exist in the service checklist.
    const checkSets = parseCheckSets(item.serviceItem.checkSets);
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

    await prisma.requestItem.update({
      where: { id: item.id },
      data: { assessment: nextState as unknown as Prisma.InputJsonValue },
    });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: "request.assessment.save",
      entityType: "RequestItem",
      entityId: item.id,
      before: { assessment: item.assessment },
      after: {
        assessed: summary.assessed,
        total: summary.total,
        recommendation: summary.recommendation,
      },
    });

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
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

const saveTechnicalReviewChecklistSchema = z.object({
  requestId: z.string().min(1),
  verdicts: z.record(
    z.string(),
    z.enum(["COMPLIANT", "NON_COMPLIANT", "NA"]),
  ),
  notes: z.record(z.string(), z.string().trim().max(1000)).optional(),
});

/**
 * Technical Reviewer's meta-checklist results, scored against the single
 * global TechnicalReviewChecklist definition — request-level (not per item),
 * distinct from saveAssessment's per-service checklist.
 */
export async function saveTechnicalReviewChecklist(
  input: z.infer<typeof saveTechnicalReviewChecklistSchema>,
): Promise<ActionResult<{ recommendation: string; complete: boolean }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = saveTechnicalReviewChecklistSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: {
        id: true,
        state: true,
        organisationId: true,
        technicalReviewChecklist: true,
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (request.state !== "TECHNICAL_REVIEW") {
      return { ok: false, error: "INVALID_STATE" };
    }

    const definition = await prisma.technicalReviewChecklist.findUnique({
      where: { id: "singleton" },
    });
    const checkSets = parseCheckSets(definition?.checkSets);
    if (!hasCheckItems(checkSets)) {
      return { ok: false, error: "NO_CHECKLIST" };
    }
    const known = new Set(checkSets.flatMap((s) => s.items.map((i) => i.code)));

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
      data: {
        technicalReviewChecklist: nextState as unknown as Prisma.InputJsonValue,
      },
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.technicalReviewChecklist.save",
      entityType: "Request",
      entityId: request.id,
      before: { technicalReviewChecklist: request.technicalReviewChecklist },
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

const saveTechnicalReviewChecklistDefinitionSchema = z.object({
  items: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .regex(/^[A-Z0-9_]+$/, "INVALID_CODE"),
        titleEn: z.string().trim().min(1).max(200),
        titleAr: z.string().trim().min(1).max(200),
      }),
    )
    .max(50),
});

/** Admin-editable definition of the single global Technical Review meta-checklist. */
export async function saveTechnicalReviewChecklistDefinition(
  input: z.infer<typeof saveTechnicalReviewChecklistDefinitionSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");
    const parsed = saveTechnicalReviewChecklistDefinitionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const codes = new Set(parsed.data.items.map((i) => i.code));
    if (codes.size !== parsed.data.items.length) {
      return { ok: false, error: "DUPLICATE_CODE" };
    }

    const checkSets = [
      {
        code: "TECHNICAL_REVIEW",
        titleEn: "Technical Review Checklist",
        titleAr: "قائمة تدقيق المراجعة الفنية",
        items: parsed.data.items,
      },
    ];

    await prisma.technicalReviewChecklist.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        checkSets: checkSets as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
      update: {
        checkSets: checkSets as unknown as Prisma.InputJsonValue,
        updatedByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: session.organisationId,
      action: "settings.technicalReviewChecklist.save",
      entityType: "TechnicalReviewChecklist",
      entityId: "singleton",
      after: { itemCount: parsed.data.items.length },
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

// ─── Evaluation activities (Shipment Inspection / Laboratory Testing / Factory Audit) ──

const EVALUATION_ACTIVITY_TYPES = [
  "SHIPMENT_INSPECTION",
  "LABORATORY_TESTING",
  "FACTORY_AUDIT",
] as const;
type EvaluationActivityTypeInput = (typeof EVALUATION_ACTIVITY_TYPES)[number];

const ACTIVITY_FLAG_FOR_TYPE: Record<
  EvaluationActivityTypeInput,
  "requiresInspection" | "requiresLabTesting" | "requiresFactoryAudit"
> = {
  SHIPMENT_INSPECTION: "requiresInspection",
  LABORATORY_TESTING: "requiresLabTesting",
  FACTORY_AUDIT: "requiresFactoryAudit",
};

const scheduleEvaluationActivitySchema = z.object({
  requestItemId: z.string().min(1),
  type: z.enum(EVALUATION_ACTIVITY_TYPES),
  scheduledDate: z.string().trim().min(1).optional(),
  assignedUserId: z.string().min(1).optional(),
  qualificationNote: z.string().trim().max(500).optional(),
});

/**
 * Creates or updates the schedule for one of a request item's optional
 * evaluation activities. Only offered when the item's service was configured
 * to require it (ACTIVITY_FLAG_FOR_TYPE), and only while assessment is
 * editable. Scheduling moves the activity to IN_PROGRESS — this is what
 * drives the "Under Inspection" / "Under Audit" badge in the UI.
 */
export async function scheduleEvaluationActivity(
  input: z.infer<typeof scheduleEvaluationActivitySchema>,
): Promise<ActionResult<{ activityId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = scheduleEvaluationActivitySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, type, qualificationNote } = parsed.data;

    const item = await prisma.requestItem.findUnique({
      where: { id: requestItemId },
      select: {
        id: true,
        serviceItem: {
          select: {
            requiresInspection: true,
            requiresLabTesting: true,
            requiresFactoryAudit: true,
          },
        },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(item.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (!item.serviceItem[ACTIVITY_FLAG_FOR_TYPE[type]]) {
      return { ok: false, error: "NOT_APPLICABLE" };
    }

    if (parsed.data.assignedUserId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: parsed.data.assignedUserId,
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
        },
        select: { id: true },
      });
      if (!assignee) return { ok: false, error: "NOT_FOUND" };
    }

    const scheduledDate = parsed.data.scheduledDate
      ? new Date(parsed.data.scheduledDate)
      : null;
    if (parsed.data.scheduledDate && Number.isNaN(scheduledDate?.getTime())) {
      return { ok: false, error: "VALIDATION" };
    }

    const existing = await prisma.requestItemActivity.findFirst({
      where: { requestItemId, type },
    });

    const activity = existing
      ? await prisma.requestItemActivity.update({
          where: { id: existing.id },
          data: {
            scheduledDate,
            assignedUserId: parsed.data.assignedUserId ?? null,
            qualificationNote: qualificationNote || null,
            status: existing.status === "COMPLETED" ? existing.status : "IN_PROGRESS",
          },
        })
      : await prisma.requestItemActivity.create({
          data: {
            requestItemId,
            type,
            status: "IN_PROGRESS",
            scheduledDate,
            assignedUserId: parsed.data.assignedUserId ?? null,
            qualificationNote: qualificationNote || null,
            createdByUserId: session.id,
          },
        });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: existing
        ? "request.activity.reschedule"
        : "request.activity.schedule",
      entityType: "RequestItemActivity",
      entityId: activity.id,
      after: {
        type,
        scheduledDate: scheduledDate?.toISOString() ?? null,
        assignedUserId: parsed.data.assignedUserId ?? null,
      },
    });

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
    return { ok: true, data: { activityId: activity.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const completeEvaluationActivitySchema = z.object({
  activityId: z.string().min(1),
  notes: z.string().trim().max(1000).optional(),
});

/** Marks an activity COMPLETED. Requires at least one uploaded report on it. */
export async function completeEvaluationActivity(
  input: z.infer<typeof completeEvaluationActivitySchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeEvaluationActivitySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const activity = await prisma.requestItemActivity.findUnique({
      where: { id: parsed.data.activityId },
      include: {
        requestItem: {
          select: {
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!activity) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(activity.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    const reportCount = await prisma.requestDocument.count({
      where: { activityId: activity.id, currentVersionId: { not: null } },
    });
    if (reportCount === 0) {
      return { ok: false, error: "REPORT_REQUIRED" };
    }

    await prisma.requestItemActivity.update({
      where: { id: activity.id },
      data: {
        status: "COMPLETED",
        notes: parsed.data.notes || null,
      },
    });

    await writeAuditLog({
      session,
      organisationId: activity.requestItem.request.organisationId,
      action: "request.activity.complete",
      entityType: "RequestItemActivity",
      entityId: activity.id,
      after: { type: activity.type },
    });

    revalidatePath(
      `/[locale]/admin/requests/${activity.requestItem.request.id}`,
      "page",
    );
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const ACTIVITY_REPORT_ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];
const ACTIVITY_REPORT_MAX_MB = 50;

/** Uploads an Inspection/Test/Audit report, linked to a specific evaluation activity. Supports multiple uploads (each a new version-1 RequestDocument), matching the spec's "upload one or multiple Test Reports". */
export async function uploadActivityReport(formData: FormData): Promise<
  ActionResult<{ documentId: string; fileName: string }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const activityId = String(formData.get("activityId") ?? "");
    if (!activityId) return { ok: false, error: "VALIDATION" };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "NO_FILE" };
    }

    const activity = await prisma.requestItemActivity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        type: true,
        requestItem: {
          select: {
            id: true,
            requestId: true,
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!activity) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(activity.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    if (!ACTIVITY_REPORT_ACCEPTED.includes(file.type)) {
      return { ok: false, error: "MIME_REJECTED" };
    }
    if (file.size > ACTIVITY_REPORT_MAX_MB * 1024 * 1024) {
      return { ok: false, error: "FILE_TOO_LARGE" };
    }

    const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
    const { storage } = await import("@/lib/storage");
    const { createHash } = await import("node:crypto");
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, ACTIVITY_REPORT_ACCEPTED)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const orgId = activity.requestItem.request.organisationId;
    const requestId = activity.requestItem.requestId;
    const stored = await storage.put({
      keyPrefix: `orgs/${orgId}/requests/${requestId}/activities/${activity.id}`,
      fileName: file.name,
      mimeType: sniffed,
      body: buffer,
    });

    const doc = await prisma.$transaction(async (tx) => {
      // Laboratory Testing supports multiple reports: each upload is its own
      // RequestDocument (not a new version of one), so prior reports stay intact.
      const created = await tx.requestDocument.create({
        data: {
          requestId,
          requestItemId: activity.requestItem.id,
          activityId: activity.id,
          label: `${activity.type} report`,
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: created.id,
          version: 1,
          fileName: file.name,
          mimeType: sniffed,
          sizeBytes: buffer.byteLength,
          storageKey: stored.key,
          sha256,
          uploadedByUserId: session.id,
          avStatus: "CLEAN",
        },
      });
      await tx.requestDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
      return created;
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.activity.report.upload",
      entityType: "RequestDocument",
      entityId: doc.id,
      after: { activityId: activity.id, fileName: file.name },
    });

    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    return { ok: true, data: { documentId: doc.id, fileName: file.name } };
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

/**
 * Marker label identifying an Evaluation Report `RequestDocument` (no
 * `activityId`/`requiredDocumentId` — a request-item-level document distinct
 * from activity reports and client-submitted required documents). Mirrors
 * the `${activity.type} report` label convention `uploadActivityReport`
 * already uses to distinguish document purpose without a dedicated column.
 */
const EVALUATION_REPORT_LABEL = "Evaluation Report";
const EVALUATION_REPORT_ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];
const EVALUATION_REPORT_MAX_MB = 50;

/** Every RequestItem on the request has an uploaded, current Evaluation Report. */
async function hasEvaluationReportForAllItems(requestId: string): Promise<boolean> {
  const items = await prisma.requestItem.findMany({
    where: { requestId },
    select: {
      documents: {
        where: { label: EVALUATION_REPORT_LABEL, currentVersionId: { not: null } },
        select: { id: true },
        take: 1,
      },
    },
  });
  return items.length > 0 && items.every((item) => item.documents.length > 0);
}

export async function uploadEvaluationReport(formData: FormData): Promise<
  ActionResult<{ documentId: string; fileName: string }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const requestItemId = String(formData.get("requestItemId") ?? "");
    if (!requestItemId) return { ok: false, error: "VALIDATION" };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "NO_FILE" };
    }

    const item = await prisma.requestItem.findUnique({
      where: { id: requestItemId },
      select: {
        id: true,
        requestId: true,
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (item.request.state !== "ASSESSMENT_RUNNING") {
      return { ok: false, error: "INVALID_STATE" };
    }

    if (!EVALUATION_REPORT_ACCEPTED.includes(file.type)) {
      return { ok: false, error: "MIME_REJECTED" };
    }
    if (file.size > EVALUATION_REPORT_MAX_MB * 1024 * 1024) {
      return { ok: false, error: "FILE_TOO_LARGE" };
    }

    const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
    const { storage } = await import("@/lib/storage");
    const { createHash } = await import("node:crypto");
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, EVALUATION_REPORT_ACCEPTED)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const orgId = item.request.organisationId;
    const requestId = item.requestId;
    const stored = await storage.put({
      keyPrefix: `orgs/${orgId}/requests/${requestId}/evaluation-report`,
      fileName: file.name,
      mimeType: sniffed,
      body: buffer,
    });

    const doc = await prisma.$transaction(async (tx) => {
      // Re-uploading replaces the prior report as a new version, unlike
      // Laboratory Testing's multiple-independent-documents pattern — there
      // is exactly one current Evaluation Report per request item.
      const existing = await tx.requestDocument.findFirst({
        where: { requestItemId: item.id, label: EVALUATION_REPORT_LABEL },
      });
      const document =
        existing ??
        (await tx.requestDocument.create({
          data: {
            requestId,
            requestItemId: item.id,
            label: EVALUATION_REPORT_LABEL,
          },
        }));
      const priorVersionCount = await tx.documentVersion.count({
        where: { documentId: document.id },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          version: priorVersionCount + 1,
          fileName: file.name,
          mimeType: sniffed,
          sizeBytes: buffer.byteLength,
          storageKey: stored.key,
          sha256,
          uploadedByUserId: session.id,
          avStatus: "CLEAN",
        },
      });
      await tx.requestDocument.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      return document;
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.evaluationReport.upload",
      entityType: "RequestDocument",
      entityId: doc.id,
      after: { requestItemId: item.id, fileName: file.name },
    });

    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    return { ok: true, data: { documentId: doc.id, fileName: file.name } };
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

// ─── External deliverables (SABER/GHAD/FASAH certificates, external lab reports) ──

const submitExternalDeliverableSchema = z.object({
  requestItemId: z.string().min(1),
  externalRefType: z.string().trim().min(1).max(60),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Marks external submission as started for a catalogue service flagged
 * EXTERNAL_CERTIFICATE (e.g. staff just submitted a SCOC application on the
 * SABER portal). The real certificate obtained from SABER/SFDA is required
 * before the Evaluator can complete issuance — see the REPORT_ISSUED ->
 * CLOSED gate in transitionAdminRequest, which requires one of these on any
 * EXTERNAL_CERTIFICATE item on the request.
 * Creates the ExternalDeliverable row if one doesn't exist yet.
 */
export async function submitExternalDeliverable(
  input: z.infer<typeof submitExternalDeliverableSchema>,
): Promise<ActionResult<{ deliverableId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = submitExternalDeliverableSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const item = await prisma.requestItem.findUnique({
      where: { id: parsed.data.requestItemId },
      select: {
        id: true,
        serviceItem: { select: { deliverableType: true } },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (item.serviceItem.deliverableType !== "EXTERNAL_CERTIFICATE") {
      return { ok: false, error: "NOT_APPLICABLE" };
    }
    if (!ASSESSMENT_EDIT_STATES.includes(item.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    const existing = await prisma.externalDeliverable.findFirst({
      where: { requestItemId: item.id },
    });

    const deliverable = existing
      ? await prisma.externalDeliverable.update({
          where: { id: existing.id },
          data: {
            status: existing.status === "ISSUED" ? existing.status : "SUBMITTED",
            externalRefType: parsed.data.externalRefType,
            notes: parsed.data.notes || null,
            submittedAt: existing.submittedAt ?? new Date(),
          },
        })
      : await prisma.externalDeliverable.create({
          data: {
            requestItemId: item.id,
            status: "SUBMITTED",
            externalRefType: parsed.data.externalRefType,
            notes: parsed.data.notes || null,
            submittedAt: new Date(),
            createdByUserId: session.id,
          },
        });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: existing
        ? "request.externalDeliverable.resubmit"
        : "request.externalDeliverable.submit",
      entityType: "ExternalDeliverable",
      entityId: deliverable.id,
      after: { externalRefType: parsed.data.externalRefType },
    });

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
    return { ok: true, data: { deliverableId: deliverable.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const markExternalDeliverableIssuedSchema = z.object({
  deliverableId: z.string().min(1),
  externalRefValue: z.string().trim().min(1).max(200),
});

/**
 * Marks an external deliverable ISSUED once the certificate/number has come
 * back from the portal/lab. Requires the certificate/report file already
 * attached (mirrors completeEvaluationActivity's report-count gate). The
 * saved externalRefValue is what a later RequestItem can pull in via
 * RequestItem.sourceRequestItemId (e.g. a FASEH Request# feeding a SCOC).
 */
export async function markExternalDeliverableIssued(
  input: z.infer<typeof markExternalDeliverableIssuedSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = markExternalDeliverableIssuedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const deliverable = await prisma.externalDeliverable.findUnique({
      where: { id: parsed.data.deliverableId },
      include: {
        requestItem: {
          select: {
            id: true,
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!deliverable) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(deliverable.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    const docCount = await prisma.requestDocument.count({
      where: {
        externalDeliverableId: deliverable.id,
        currentVersionId: { not: null },
      },
    });
    if (docCount === 0) {
      return { ok: false, error: "CERTIFICATE_REQUIRED" };
    }

    await prisma.externalDeliverable.update({
      where: { id: deliverable.id },
      data: {
        status: "ISSUED",
        externalRefValue: parsed.data.externalRefValue,
        issuedAt: new Date(),
      },
    });

    await writeAuditLog({
      session,
      organisationId: deliverable.requestItem.request.organisationId,
      action: "request.externalDeliverable.issue",
      entityType: "ExternalDeliverable",
      entityId: deliverable.id,
      after: { externalRefValue: parsed.data.externalRefValue },
    });

    revalidatePath(
      `/[locale]/admin/requests/${deliverable.requestItem.request.id}`,
      "page",
    );
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const rejectExternalDeliverableSchema = z.object({
  deliverableId: z.string().min(1),
  notes: z.string().trim().max(1000),
});

/** Marks an external submission REJECTED by the portal/lab (needs resubmission). */
export async function rejectExternalDeliverable(
  input: z.infer<typeof rejectExternalDeliverableSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = rejectExternalDeliverableSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const deliverable = await prisma.externalDeliverable.findUnique({
      where: { id: parsed.data.deliverableId },
      include: {
        requestItem: {
          select: {
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!deliverable) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(deliverable.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    await prisma.externalDeliverable.update({
      where: { id: deliverable.id },
      data: { status: "REJECTED", notes: parsed.data.notes },
    });

    await writeAuditLog({
      session,
      organisationId: deliverable.requestItem.request.organisationId,
      action: "request.externalDeliverable.reject",
      entityType: "ExternalDeliverable",
      entityId: deliverable.id,
      after: { notes: parsed.data.notes },
    });

    revalidatePath(
      `/[locale]/admin/requests/${deliverable.requestItem.request.id}`,
      "page",
    );
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const EXTERNAL_CERT_ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];
const EXTERNAL_CERT_MAX_MB = 20;

/** Uploads the certificate/report file for an external deliverable. */
export async function uploadExternalDeliverableFile(
  formData: FormData,
): Promise<ActionResult<{ documentId: string; fileName: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const deliverableId = String(formData.get("deliverableId") ?? "");
    if (!deliverableId) return { ok: false, error: "VALIDATION" };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "NO_FILE" };
    }

    const deliverable = await prisma.externalDeliverable.findUnique({
      where: { id: deliverableId },
      select: {
        id: true,
        requestItem: {
          select: {
            id: true,
            requestId: true,
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!deliverable) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(deliverable.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    if (!EXTERNAL_CERT_ACCEPTED.includes(file.type)) {
      return { ok: false, error: "MIME_REJECTED" };
    }
    if (file.size > EXTERNAL_CERT_MAX_MB * 1024 * 1024) {
      return { ok: false, error: "FILE_TOO_LARGE" };
    }

    const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
    const { storage } = await import("@/lib/storage");
    const { createHash } = await import("node:crypto");
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, EXTERNAL_CERT_ACCEPTED)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const orgId = deliverable.requestItem.request.organisationId;
    const requestId = deliverable.requestItem.requestId;
    const stored = await storage.put({
      keyPrefix: `orgs/${orgId}/requests/${requestId}/external-deliverables/${deliverable.id}`,
      fileName: file.name,
      mimeType: sniffed,
      body: buffer,
    });

    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.requestDocument.create({
        data: {
          requestId,
          requestItemId: deliverable.requestItem.id,
          externalDeliverableId: deliverable.id,
          label: "External certificate",
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: created.id,
          version: 1,
          fileName: file.name,
          mimeType: sniffed,
          sizeBytes: buffer.byteLength,
          storageKey: stored.key,
          sha256,
          uploadedByUserId: session.id,
          avStatus: "CLEAN",
        },
      });
      await tx.requestDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
      return created;
    });

    await writeAuditLog({
      session,
      organisationId: orgId,
      action: "request.externalDeliverable.file.upload",
      entityType: "RequestDocument",
      entityId: doc.id,
      after: { deliverableId: deliverable.id, fileName: file.name },
    });

    revalidatePath(`/[locale]/admin/requests/${requestId}`, "page");
    return { ok: true, data: { documentId: doc.id, fileName: file.name } };
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

const clientFacingCommentSchema = z.object({
  requestId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

/**
 * A request with no lifecycle history (DRAFT) or a dead one (CANCELLED) has
 * no thread to message on. CLOSED requests are locked against further
 * editing, including new messages, once finalized.
 */
function canMessageOnRequestState(state: RequestState): boolean {
  return state !== "DRAFT" && state !== "CANCELLED" && state !== "CLOSED";
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

const markRequestCommentsReadSchema = z.object({ requestId: z.string().min(1) });

/** Marks the client's messages and the matching in-app notification read once staff open the chat thread. */
export async function markAdminRequestCommentsRead(
  input: z.infer<typeof markRequestCommentsReadSchema>,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = markRequestCommentsReadSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: { id: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    await prisma.$transaction([
      prisma.requestComment.updateMany({
        where: {
          requestId: request.id,
          direction: "CLIENT_TO_ATLAS",
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
      prisma.notification.updateMany({
        where: {
          userId: session.id,
          link: `/admin/requests/${request.id}`,
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
    ]);

    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");
    revalidatePath("/[locale]/admin/requests", "page");
    return { ok: true, data: { ok: true } };
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
  requiresInspection: z.boolean().optional(),
  requiresLabTesting: z.boolean().optional(),
  requiresFactoryAudit: z.boolean().optional(),
  defaultEvaluatorId: z.string().min(1).nullable().optional(),
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

    if (data.defaultEvaluatorId) {
      const evaluator = await prisma.user.findFirst({
        where: {
          id: data.defaultEvaluatorId,
          status: "ACTIVE",
          organisation: { type: "ATLAS" },
          roles: { some: { role: "EVALUATOR" } },
        },
        select: { id: true },
      });
      if (!evaluator) return { ok: false, error: "VALIDATION" };
    }

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
          requiresInspection: data.requiresInspection ?? false,
          requiresLabTesting: data.requiresLabTesting ?? false,
          requiresFactoryAudit: data.requiresFactoryAudit ?? false,
          defaultEvaluatorId: data.defaultEvaluatorId ?? null,
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

    const requestCount = await prisma.requestItem.count({
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

const TEMPLATE_ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const TEMPLATE_MAX_MB = 20;

/**
 * Attaches (or replaces) the downloadable blank-form template for a required
 * document slot — e.g. the SAB-001 "Importer declaration" template clients
 * fill on their Importer Header Letter before uploading. Not tied to any
 * request/org, so a catalogue:manage upload is visible to every client.
 */
export async function uploadRequiredDocumentTemplate(formData: FormData): Promise<
  ActionResult<{ requiredDocumentId: string; fileName: string }>
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const requiredDocumentId = String(formData.get("requiredDocumentId") ?? "");
    if (!requiredDocumentId) return { ok: false, error: "VALIDATION" };
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "NO_FILE" };
    }

    const doc = await prisma.requiredDocument.findUnique({
      where: { id: requiredDocumentId },
      select: { id: true, serviceItemId: true, templateStorageKey: true },
    });
    if (!doc) return { ok: false, error: "NOT_FOUND" };

    if (!TEMPLATE_ACCEPTED_MIME_TYPES.includes(file.type)) {
      return { ok: false, error: "MIME_REJECTED" };
    }
    if (file.size > TEMPLATE_MAX_MB * 1024 * 1024) {
      return { ok: false, error: "FILE_TOO_LARGE" };
    }

    const { mimeAllowed, sniffMime } = await import("@/lib/mime-sniff");
    const { storage } = await import("@/lib/storage");
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffMime(buffer);
    if (!mimeAllowed(sniffed, TEMPLATE_ACCEPTED_MIME_TYPES)) {
      return { ok: false, error: "MIME_REJECTED" };
    }

    const { getAvScanner } = await import("@/lib/av");
    const verdict = await getAvScanner().scan(buffer);
    if (verdict === "INFECTED") {
      return { ok: false, error: "INFECTED_FILE" };
    }

    const stored = await storage.put({
      keyPrefix: `templates/service-documents/${doc.serviceItemId}`,
      fileName: file.name,
      mimeType: sniffed,
      body: buffer,
    });

    const previousKey = doc.templateStorageKey;
    await prisma.requiredDocument.update({
      where: { id: doc.id },
      data: {
        templateStorageKey: stored.key,
        templateFileName: file.name,
        templateMimeType: sniffed,
      },
    });
    if (previousKey) {
      await storage.delete(previousKey);
    }

    await writeAuditLog({
      session,
      action: "catalogue.requiredDocument.template.upload",
      entityType: "RequiredDocument",
      entityId: doc.id,
      after: { fileName: file.name },
    });

    revalidatePath("/[locale]/admin/catalogue", "page");
    return { ok: true, data: { requiredDocumentId: doc.id, fileName: file.name } };
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

const removeRequiredDocumentTemplateSchema = z.object({
  requiredDocumentId: z.string().min(1),
});

export async function removeRequiredDocumentTemplate(
  input: z.infer<typeof removeRequiredDocumentTemplateSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");
    const parsed = removeRequiredDocumentTemplateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const doc = await prisma.requiredDocument.findUnique({
      where: { id: parsed.data.requiredDocumentId },
      select: { id: true, templateStorageKey: true },
    });
    if (!doc) return { ok: false, error: "NOT_FOUND" };
    if (!doc.templateStorageKey) return { ok: true, data: undefined };

    await prisma.requiredDocument.update({
      where: { id: doc.id },
      data: {
        templateStorageKey: null,
        templateFileName: null,
        templateMimeType: null,
      },
    });
    const { storage } = await import("@/lib/storage");
    await storage.delete(doc.templateStorageKey);

    await writeAuditLog({
      session,
      action: "catalogue.requiredDocument.template.remove",
      entityType: "RequiredDocument",
      entityId: doc.id,
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
  requiresInspection: z.boolean().optional(),
  requiresLabTesting: z.boolean().optional(),
  requiresFactoryAudit: z.boolean().optional(),
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
            requiresInspection: data.requiresInspection ?? false,
            requiresLabTesting: data.requiresLabTesting ?? false,
            requiresFactoryAudit: data.requiresFactoryAudit ?? false,
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

const STAFF_INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function inviteAtlasStaff(
  input: InviteAtlasStaffInput,
): Promise<ActionResult<{ userId: string; emailed: boolean }>> {
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

    // No password is generated or emailed here: the invitee sets their own
    // via the invite-link flow below, so this hash is never usable.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
    const usernameBase = parsed.data.email
      .split("@")[0]
      ?.replace(/[^a-zA-Z0-9._-]/g, ".")
      .slice(0, 40);
    const username = `${usernameBase}.${Date.now().toString(36)}`;
    const { ip, userAgent } = await requestMeta();

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organisationId: atlasOrgId,
          email: parsed.data.email,
          username,
          passwordHash,
          fullNameEn: parsed.data.fullNameEn,
          fullNameAr: parsed.data.fullNameAr,
          locale: "ar",
          status: "ACTIVE",
          // Stays unverified/unusable for login until the invitee completes
          // the invite link, which sets their password and verifies email.
          roles: { create: [{ role: parsed.data.role }] },
        },
      });

      await writeAuditLog({
        session,
        tx,
        action: "staff.invite",
        entityType: "User",
        entityId: created.id,
        ip,
        userAgent,
        after: {
          email: created.email,
          role: parsed.data.role,
          organisationId: atlasOrgId,
        },
      });

      return created;
    });

    // The account and audit trail are already committed above; a failure
    // here only means the invite link needs to be resent, not data loss.
    let emailed = false;
    try {
      const token = await issueVerificationToken(
        user.id,
        "PASSWORD_RESET",
        STAFF_INVITE_TOKEN_TTL_MS,
      );
      emailed = await sendInviteEmail({
        to: user.email,
        locale: user.locale,
        token,
      });
    } catch {
      emailed = false;
    }

    revalidatePath("/[locale]/admin/settings", "page");
    return {
      ok: true,
      data: { userId: user.id, emailed },
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
