"use server";

import { Prisma, type RequestState } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  computeAssessment,
  hasCheckItems,
  parseAssessment,
  parseCheckSets,
  type AssessmentState,
} from "@/lib/assessment";
import { writeAuditLog } from "@/lib/audit";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { evaluationReportLabelsFor } from "@/lib/evaluation-report-labels";
import { log } from "@/lib/logger";
import { canTransitionRequest, requirePermission } from "@/lib/rbac";
import {
  isTariffEvalServiceCode,
  parseSnapshot,
  snapshotItemCount,
} from "@/lib/tariff-evaluation-services";
import { resumeSlaDueAt } from "@/lib/sla";
import {
  allowedTransitionsFor,
  canReopenRequest,
  isLabTestingOnlyRequest,
  isScocOnlyRequest,
  NEW_REQUEST_STATES,
  onHoldResumeTarget,
  REOPEN_TARGET_STATES,
} from "@/server/admin/queries";
import { checkTransitionGuards } from "@/server/admin/transition-guards";
import { appendReversingEntry } from "@/server/finance/ledger";
import { IN_FLIGHT_STATUSES } from "@/server/label-eval/concurrency";

/**
 * Request-lifecycle server actions: the state-machine transition, its
 * composite shortcuts (Complete Application Review, Complete Lab Testing),
 * reopen/assign, comments, technical assessment/checklist, evaluation
 * activities (inspection/lab/audit), and external-deliverable (SABER/GHAD/
 * FASAH certificate) handling. Split out of the former admin/actions.ts —
 * see catalogue-actions.ts, coupons-actions.ts, staff-actions.ts, and
 * laboratories-actions.ts for the reference-data/organisation-management
 * actions that used to share this file.
 */

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
  /** Required on the three Conflict-of-Interest-gated transitions; see COI_GATED_TRANSITIONS in transition-guards.ts. */
  coiAcknowledged: z.literal(true).optional(),
});

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
          orderBy: { sortOrder: "asc" },
          select: { serviceItem: { select: { code: true, nameEn: true, nameAr: true } } },
        },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    const serviceNameEn = request.items[0]?.serviceItem.nameEn ?? "";
    const serviceNameAr = request.items[0]?.serviceItem.nameAr ?? "";

    const allowed = allowedTransitionsFor({
      state: request.state,
      heldFromState: request.heldFromState,
      serviceCodes: request.items.map((i) => i.serviceItem.code),
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

    const guardResult = checkTransitionGuards({
      fromState: request.state,
      toState,
      note,
      reasonCodes,
      faultAttribution,
      coiAcknowledged,
    });
    if (!guardResult.ok) {
      return { ok: false, error: guardResult.error };
    }

    if (
      request.state === "ASSESSMENT_RUNNING" &&
      (toState === "TECHNICAL_REVIEW" || toState === "DECISION") &&
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

      // PCOC (SAB-001) has no EXTERNAL_CERTIFICATE deliverable of its own —
      // the certificate is issued directly on the SABER system, not uploaded
      // through ExternalDeliverable. Require the Evaluator to confirm it was
      // uploaded to the request before closing.
      const pcocItemCount = await prisma.requestItem.count({
        where: { requestId: request.id, serviceItem: { code: "SAB-001" } },
      });
      if (pcocItemCount > 0) {
        const current = await prisma.request.findUnique({
          where: { id: request.id },
          select: { saberCertificateUploaded: true },
        });
        if (!current?.saberCertificateUploaded) {
          return { ok: false, error: "SABER_CERTIFICATE_UPLOAD_REQUIRED" };
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
  /**
   * How the Evaluator should assess this request's Label-Evaluator-covered
   * items: "AI" (extraction + rule engine) or "MANUAL" (hand-worked
   * checklist). Optional — omitted leaves every item unassigned, and both
   * routes stay offered downstream, which is exactly the pre-existing
   * behaviour.
   */
  assessmentMethod: z.enum(["AI", "MANUAL"]).optional(),
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
    const { requestId, assessmentMethod } = parsed.data;

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

      // Record the Intake Officer's chosen route. Scoped to items the Label
      // Evaluator actually covers — an unmapped service has no AI route, so
      // stamping one on it would be a meaningless claim. The Evaluator can
      // still change it later (setItemAssessmentMethod).
      if (assessmentMethod) {
        const mapped = await tx.labelEvalServiceMapping.findMany({
          where: { serviceItemId: { in: request.items.map((i) => i.serviceItemId) } },
          select: { serviceItemId: true },
        });
        const mappedIds = new Set(mapped.map((m) => m.serviceItemId));
        const targetItemIds = request.items
          .filter((i) => mappedIds.has(i.serviceItemId))
          .map((i) => i.id);
        if (targetItemIds.length > 0) {
          await tx.requestItem.updateMany({
            where: { id: { in: targetItemIds } },
            data: { assessmentMethod },
          });
        }
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
          after: { state: "ASSESSMENT_RUNNING", assignedToUserId: evaluatorId, assessmentMethod: assessmentMethod ?? null },
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

const completeLabTestingSchema = z.object({
  requestId: z.string().min(1),
  coiAcknowledged: z.literal(true),
});

/**
 * "Complete Testing": Lab Testing Coordination (LAB-001) has no
 * Atlas-authored technical content to review or certify — the deliverable is
 * the external lab's own test report, already uploaded against the
 * LABORATORY_TESTING RequestItemActivity — so this is a one-click completion
 * mirroring completeApplicationReview's cascade: ASSESSMENT_RUNNING ->
 * REPORT_ISSUED -> CLOSED in a single transaction, each hop still its own
 * RequestEvent. Only valid for requests made up entirely of LAB-001 items
 * (see isLabTestingOnlyRequest) — a bundled request keeps the normal
 * Technical Review / Decision pipeline.
 */
export async function completeLabTesting(
  input: z.infer<typeof completeLabTestingSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = completeLabTestingSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestId, coiAcknowledged } = parsed.data;

    const request = await prisma.request.findUnique({
      where: { id: requestId },
      include: {
        createdBy: { select: { id: true } },
        organisation: { select: { nameEn: true, nameAr: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            serviceItem: { select: { code: true, nameEn: true, nameAr: true } },
            activities: { where: { type: "LABORATORY_TESTING" } },
          },
        },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };

    if (request.state !== "ASSESSMENT_RUNNING") {
      return { ok: false, error: "INVALID_TRANSITION" };
    }

    const serviceCodes = request.items.map((item) => item.serviceItem.code);
    if (!isLabTestingOnlyRequest(serviceCodes)) {
      return { ok: false, error: "INVALID_TRANSITION" };
    }

    if (
      !canTransitionRequest(session, "REPORT_ISSUED", {
        fromState: request.state,
      })
    ) {
      return { ok: false, error: "FORBIDDEN" };
    }

    // Every item's lab testing activity must be COMPLETED — which itself
    // already required >=1 uploaded report (see completeEvaluationActivity's
    // REPORT_REQUIRED gate) — before the request can close as "Completed".
    const allReported = request.items.every((item) =>
      item.activities.some((activity) => activity.status === "COMPLETED"),
    );
    if (!allReported) {
      return { ok: false, error: "LAB_REPORT_REQUIRED" };
    }

    if (!coiAcknowledged) {
      return { ok: false, error: "COI_ACKNOWLEDGEMENT_REQUIRED" };
    }

    const serviceNameEn = request.items[0]?.serviceItem.nameEn ?? "";
    const serviceNameAr = request.items[0]?.serviceItem.nameAr ?? "";

    await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.request.updateMany({
        where: { id: requestId, state: "ASSESSMENT_RUNNING" },
        data: { state: "CLOSED", closedAt: now },
      });
      if (updated.count === 0) {
        throw new Error("CONFLICT");
      }

      const chain: Array<[RequestState, RequestState, string]> = [
        [
          "ASSESSMENT_RUNNING",
          "REPORT_ISSUED",
          "Lab testing completed — test reports uploaded",
        ],
        ["REPORT_ISSUED", "CLOSED", "Completed (auto-advanced)"],
      ];
      for (const [fromState, toState, note] of chain) {
        await tx.requestEvent.create({
          data: {
            requestId,
            fromState,
            toState,
            actorUserId: session.id,
            actorRole: session.roles[0] ?? "SYSTEM_ADMIN",
            note,
            metadata:
              toState === "REPORT_ISSUED"
                ? ({
                    coiAcknowledged: true,
                    coiAcknowledgedAt: now.toISOString(),
                  } as Prisma.InputJsonValue)
                : ({} as Prisma.InputJsonValue),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: session.id,
          actorRole: session.roles[0],
          organisationId: request.organisationId,
          action: "request.completeLabTesting",
          entityType: "Request",
          entityId: requestId,
          before: { state: request.state },
          after: { state: "CLOSED" },
        },
      });

      try {
        const { notify } = await import("@/server/notifications/notify");
        const { notificationCopy } = await import(
          "@/server/notifications/copy"
        );

        if (request.createdBy) {
          const eventType = notificationEventForState("REPORT_ISSUED", "CLOSED");
          if (eventType) {
            const copy = notificationCopy(eventType, {
              requestNo: request.requestNo,
              customerNameEn: request.organisation.nameEn,
              customerNameAr: request.organisation.nameAr,
              serviceNameEn,
              serviceNameAr,
            });
            await notify(
              {
                event: eventType,
                data: {
                  requestId,
                  requestNo: request.requestNo,
                  state: "CLOSED",
                  link: `/client/requests/${requestId}`,
                  organisationId: request.organisationId,
                  createdByUserId: request.createdBy.id,
                  ...copy,
                },
              },
              tx,
            );
          }
        }
      } catch (error) {
        log.error(
          "admin.requests.completeLabTesting",
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
 * Reopen bypasses the forward-only REQUEST_TRANSITIONS graph entirely (a
 * CLOSED/CANCELLED request can resume straight into TECHNICAL_REVIEW or
 * DECISION — see REOPEN_TARGET_STATES), so it must re-check the same
 * certification-integrity gates transitionAdminRequest enforces on that
 * graph, or a request cancelled before evaluation ever started (e.g. while
 * still ACCEPTED/ASSESSMENT_QUEUED — CANCELLED is reachable from most active
 * states) could be reopened straight to DECISION and certified with no
 * evaluation evidence on file at all.
 */
async function assertReopenTargetSatisfiesGates(
  requestId: string,
  serviceCodes: string[],
  targetState: RequestState,
): Promise<"EVALUATION_REPORT_REQUIRED" | "TECHNICAL_REVIEW_CHECKLIST_INCOMPLETE" | null> {
  if (targetState !== "TECHNICAL_REVIEW" && targetState !== "DECISION") {
    return null;
  }
  if (!(await hasEvaluationReportForAllItems(requestId))) {
    return "EVALUATION_REPORT_REQUIRED";
  }
  if (
    targetState === "DECISION" &&
    !isScocOnlyRequest(serviceCodes) &&
    !isLabTestingOnlyRequest(serviceCodes)
  ) {
    const [definition, requestChecklist] = await Promise.all([
      prisma.technicalReviewChecklist.findUnique({ where: { id: "singleton" } }),
      prisma.request.findUnique({
        where: { id: requestId },
        select: { technicalReviewChecklist: true },
      }),
    ]);
    const checkSets = parseCheckSets(definition?.checkSets);
    if (hasCheckItems(checkSets)) {
      const state = parseAssessment(requestChecklist?.technicalReviewChecklist);
      if (!computeAssessment(checkSets, state).complete) {
        return "TECHNICAL_REVIEW_CHECKLIST_INCOMPLETE";
      }
    }
  }
  return null;
}

/**
 * Approves or rejects a client's pending request to reopen a CLOSED/CANCELLED
 * request. Approval requires an active destination stage and moves the
 * request there with a fresh SLA clock; rejection requires an explanation and
 * leaves the request untouched.
 */
/**
 * A request reopened back into evaluation must not carry a stale decision.
 * `finalDecision` is what the completion gate checks, so leaving it set would
 * let the request advance again on answers the evaluator is now editing.
 * Clearing it (and completedAt) puts the evaluation back in progress with its
 * answers and pinned template intact.
 */
async function clearTariffEvaluationCompletion(
  tx: Prisma.TransactionClient,
  requestId: string,
  targetState: RequestState,
): Promise<void> {
  if (targetState !== "ASSESSMENT_RUNNING") return;
  await tx.tariffEvaluation.updateMany({
    where: { requestItem: { requestId } },
    data: { finalDecision: null, completedAt: null },
  });
}

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
      include: {
        items: { include: { serviceItem: { select: { slaHours: true, code: true } } } },
      },
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
    if (decision === "APPROVE") {
      const gateError = await assertReopenTargetSatisfiesGates(
        request.id,
        request.items.map((i) => i.serviceItem.code),
        targetState!,
      );
      if (gateError) {
        return { ok: false, error: gateError };
      }
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

        await clearTariffEvaluationCompletion(tx, request.id, targetState!);
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
      include: {
        items: { include: { serviceItem: { select: { slaHours: true, code: true } } } },
      },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (!canReopenRequest(request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    const requestSlaHours = Math.max(
      ...request.items.map((i) => i.serviceItem.slaHours),
    );

    const gateError = await assertReopenTargetSatisfiesGates(
      request.id,
      request.items.map((i) => i.serviceItem.code),
      targetState,
    );
    if (gateError) {
      return { ok: false, error: gateError };
    }

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

      await clearTariffEvaluationCompletion(tx, requestId, targetState);

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

    const { storeCommentAttachment, attachmentToJson } = await import(
      "@/server/comments/attachment"
    );
    let attachment: import("@/server/comments/attachment").CommentAttachment | null =
      null;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      const stored = await storeCommentAttachment(
        file,
        `orgs/${request.organisationId}/requests/${request.id}/notes`,
      );
      if (!stored.ok) return { ok: false, error: stored.error };
      attachment = stored.attachment;
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
          attachments: attachmentToJson(attachment),
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
 * drives the "Under Inspection" / "Under Audit" badge in the UI. For
 * LABORATORY_TESTING specifically, this does NOT flip to IN_PROGRESS —
 * "Under testing" instead reflects samples actually having been received by
 * the lab (see confirmSampleReceived), since scheduling here only assigns
 * the internal Atlas coordinator.
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
            status:
              existing.status === "COMPLETED" || type === "LABORATORY_TESTING"
                ? existing.status
                : "IN_PROGRESS",
          },
        })
      : await prisma.requestItemActivity.create({
          data: {
            requestItemId,
            type,
            status: type === "LABORATORY_TESTING" ? "SCHEDULED" : "IN_PROGRESS",
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

const addRequiredTestSchema = z.object({
  requestItemId: z.string().min(1),
  testTypeId: z.string().min(1).optional(),
  customLabel: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Adds one row to a Lab Testing request item's admin-curated "required
 * tests" checklist — the structured counterpart to the client's free-text
 * productAttrs.required_tests — either a catalogue TestType or a one-off
 * customLabel for a test not in the catalogue.
 */
export async function addRequiredTest(
  input: z.infer<typeof addRequiredTestSchema>,
): Promise<ActionResult<{ id: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = addRequiredTestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, testTypeId, customLabel, notes } = parsed.data;
    if (!testTypeId && !customLabel) {
      return { ok: false, error: "VALIDATION" };
    }

    const item = await prisma.requestItem.findUnique({
      where: { id: requestItemId },
      select: {
        id: true,
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(item.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    if (testTypeId) {
      const testType = await prisma.testType.findFirst({
        where: { id: testTypeId, active: true },
        select: { id: true },
      });
      if (!testType) return { ok: false, error: "NOT_FOUND" };
    }

    const row = await prisma.requestItemRequiredTest.create({
      data: {
        requestItemId,
        testTypeId: testTypeId ?? null,
        customLabel: customLabel || null,
        notes: notes || null,
        createdByUserId: session.id,
      },
    });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: "request.requiredTest.add",
      entityType: "RequestItemRequiredTest",
      entityId: row.id,
      after: {
        requestItemId,
        testTypeId: testTypeId ?? null,
        customLabel: customLabel ?? null,
      },
    });

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
    return { ok: true, data: { id: row.id } };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}

const removeRequiredTestSchema = z.object({ id: z.string().min(1) });

export async function removeRequiredTest(
  input: z.infer<typeof removeRequiredTestSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = removeRequiredTestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const row = await prisma.requestItemRequiredTest.findUnique({
      where: { id: parsed.data.id },
      include: {
        requestItem: {
          select: {
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!row) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(row.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }

    await prisma.requestItemRequiredTest.delete({ where: { id: row.id } });

    await writeAuditLog({
      session,
      organisationId: row.requestItem.request.organisationId,
      action: "request.requiredTest.remove",
      entityType: "RequestItemRequiredTest",
      entityId: row.id,
      before: { testTypeId: row.testTypeId, customLabel: row.customLabel },
    });

    revalidatePath(
      `/[locale]/admin/requests/${row.requestItem.request.id}`,
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

const selectLaboratorySchema = z.object({
  requestItemId: z.string().min(1),
  laboratoryId: z.string().min(1),
});

/**
 * Selects the accredited laboratory samples will be sent to for this item's
 * Laboratory Testing activity. This is the first Lab Testing step that
 * touches RequestItemActivity, so — unlike selectLaboratory's siblings — it
 * finds-or-creates the activity row (same upsert shape as
 * scheduleEvaluationActivity) rather than requiring one to already exist.
 */
export async function selectLaboratory(
  input: z.infer<typeof selectLaboratorySchema>,
): Promise<ActionResult<{ activityId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = selectLaboratorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, laboratoryId } = parsed.data;

    const item = await prisma.requestItem.findUnique({
      where: { id: requestItemId },
      select: {
        id: true,
        serviceItem: { select: { requiresLabTesting: true } },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (!ASSESSMENT_EDIT_STATES.includes(item.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (!item.serviceItem.requiresLabTesting) {
      return { ok: false, error: "NOT_APPLICABLE" };
    }

    const lab = await prisma.laboratory.findFirst({
      where: { id: laboratoryId, active: true },
      select: { id: true },
    });
    if (!lab) return { ok: false, error: "NOT_FOUND" };

    const existing = await prisma.requestItemActivity.findFirst({
      where: { requestItemId, type: "LABORATORY_TESTING" },
    });

    const activity = existing
      ? await prisma.requestItemActivity.update({
          where: { id: existing.id },
          data: { laboratoryId },
        })
      : await prisma.requestItemActivity.create({
          data: {
            requestItemId,
            type: "LABORATORY_TESTING",
            status: "SCHEDULED",
            laboratoryId,
            createdByUserId: session.id,
          },
        });

    await writeAuditLog({
      session,
      organisationId: item.request.organisationId,
      action: "request.laboratory.select",
      entityType: "RequestItemActivity",
      entityId: activity.id,
      after: { laboratoryId },
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

const recordSampleShipmentSchema = z.object({
  activityId: z.string().min(1),
  trackingNumber: z.string().trim().max(120).optional(),
  carrier: z.string().trim().max(120).optional(),
  sentAt: z.string().trim().min(1),
});

/** Records the sample shipment to the selected lab. Requires a laboratory to
 * already be selected on the activity (order: select lab -> send samples). */
export async function recordSampleShipment(
  input: z.infer<typeof recordSampleShipmentSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = recordSampleShipmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { activityId, trackingNumber, carrier } = parsed.data;

    const activity = await prisma.requestItemActivity.findUnique({
      where: { id: activityId },
      include: {
        requestItem: {
          select: {
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!activity || activity.type !== "LABORATORY_TESTING") {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (!ASSESSMENT_EDIT_STATES.includes(activity.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (!activity.laboratoryId) {
      return { ok: false, error: "LABORATORY_REQUIRED" };
    }

    const sentAt = new Date(parsed.data.sentAt);
    if (Number.isNaN(sentAt.getTime())) return { ok: false, error: "VALIDATION" };

    await prisma.requestItemActivity.update({
      where: { id: activity.id },
      data: {
        sampleTrackingNo: trackingNumber || null,
        sampleCarrier: carrier || null,
        sampleSentAt: sentAt,
      },
    });

    await writeAuditLog({
      session,
      organisationId: activity.requestItem.request.organisationId,
      action: "request.sample.shipment.record",
      entityType: "RequestItemActivity",
      entityId: activity.id,
      after: {
        sentAt: sentAt.toISOString(),
        trackingNumber: trackingNumber ?? null,
        carrier: carrier ?? null,
      },
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

const confirmSampleReceivedSchema = z.object({
  activityId: z.string().min(1),
  receivedAt: z.string().trim().min(1),
});

/**
 * Marks samples as received by the lab — this is what flips a
 * LABORATORY_TESTING activity to IN_PROGRESS ("Under testing"), not the
 * schedule step. Requires a shipment to already be recorded.
 */
export async function confirmSampleReceived(
  input: z.infer<typeof confirmSampleReceivedSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = confirmSampleReceivedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { activityId } = parsed.data;

    const activity = await prisma.requestItemActivity.findUnique({
      where: { id: activityId },
      include: {
        requestItem: {
          select: {
            request: { select: { id: true, state: true, organisationId: true } },
          },
        },
      },
    });
    if (!activity || activity.type !== "LABORATORY_TESTING") {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (!ASSESSMENT_EDIT_STATES.includes(activity.requestItem.request.state)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (!activity.sampleSentAt) {
      return { ok: false, error: "SHIPMENT_NOT_SENT" };
    }

    const receivedAt = new Date(parsed.data.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) {
      return { ok: false, error: "VALIDATION" };
    }

    await prisma.requestItemActivity.update({
      where: { id: activity.id },
      data: {
        sampleReceivedAt: receivedAt,
        status: activity.status === "COMPLETED" ? activity.status : "IN_PROGRESS",
      },
    });

    await writeAuditLog({
      session,
      organisationId: activity.requestItem.request.organisationId,
      action: "request.sample.received.confirm",
      entityType: "RequestItemActivity",
      entityId: activity.id,
      after: { receivedAt: receivedAt.toISOString() },
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

const EVALUATION_REPORT_ACCEPTED = ["application/pdf", "image/png", "image/jpeg"];
const EVALUATION_REPORT_MAX_MB = 50;

/**
 * Every RequestItem on the request has satisfied its Evaluation step.
 *
 * Most services satisfy it by uploading the required Evaluation Report
 * document(s). For SAB-001/SFDA-COS-002 (see isTariffEvalServiceCode) a
 * completed tariff evaluation via TariffEvaluationPanel takes its place: the
 * technical-regulation assessment is the evaluation evidence, so those
 * services are not asked for the report file as well. They fall back to the
 * report upload only when no such assessment is possible (empty pinned
 * template, or no usable regulation in the catalog).
 *
 * The tariff-evaluation requirement is conditional on the service actually
 * having a USABLE catalog — at least one active regulation that has checklist
 * items to answer. Without that condition a service with an empty catalog
 * (SFDA-COS-002 ships with none) could never satisfy the gate: there is
 * nothing to select or nothing to answer, so finalDecision can never be set
 * and every request would be stuck in ASSESSMENT_RUNNING for good. Once
 * Quality populates that service's catalog, the requirement starts applying
 * on its own.
 */
async function hasEvaluationReportForAllItems(requestId: string): Promise<boolean> {
  const items = await prisma.requestItem.findMany({
    where: { requestId },
    select: {
      serviceItemId: true,
      serviceItem: { select: { code: true } },
      documents: {
        where: { currentVersionId: { not: null } },
        select: { label: true },
      },
      tariffEvaluation: { select: { finalDecision: true, templateSnapshot: true } },
    },
  });
  if (items.length === 0) return false;

  const tariffServiceItemIds = items
    .filter((i) => isTariffEvalServiceCode(i.serviceItem.code))
    .map((i) => i.serviceItemId);

  const regulations =
    tariffServiceItemIds.length > 0
      ? await prisma.technicalRegulation.findMany({
          where: { serviceItemId: { in: tariffServiceItemIds }, active: true },
          select: {
            serviceItemId: true,
            generalChecklist: true,
            labelingChecklist: true,
            documentsChecklist: true,
            standards: { where: { active: true }, select: { checklist: true } },
          },
        })
      : [];

  const configured = new Set(
    regulations
      .filter((regulation) => {
        const count = (raw: Prisma.JsonValue) =>
          parseCheckSets(raw).reduce((n, set) => n + set.items.length, 0);
        return (
          count(regulation.generalChecklist) +
            count(regulation.labelingChecklist) +
            count(regulation.documentsChecklist) +
            regulation.standards.reduce((n, s) => n + count(s.checklist), 0) >
          0
        );
      })
      .map((regulation) => regulation.serviceItemId),
  );

  return items.every((item) => {
    const reportUploaded = () => {
      const required = evaluationReportLabelsFor(item.serviceItem.code);
      const uploadedLabels = new Set(item.documents.map((d) => d.label));
      return required.every((label) => uploadedLabels.has(label));
    };

    if (!isTariffEvalServiceCode(item.serviceItem.code)) return reportUploaded();

    // PCOC/Cosmetic SCOC: a completed technical-regulation assessment IS the
    // evaluation evidence, so it stands in for the uploaded Evaluation Report
    // rather than being demanded on top of it. The upload is only asked for
    // when no such assessment can exist — an empty pinned template, or a
    // service whose catalog has no usable regulation at all.
    //
    // Once an evaluation exists, its own pinned snapshot decides whether there
    // was anything to assess — not whether some OTHER regulation under the same
    // service happens to be configured. Asking the service-wide question would
    // demand a decision that completeTariffEvaluation refuses to produce
    // (NO_CHECKLIST_ITEMS), leaving the request unable to advance.
    const evaluation = item.tariffEvaluation;
    if (evaluation) {
      const snapshot = parseSnapshot(evaluation.templateSnapshot);
      if (snapshot && snapshotItemCount(snapshot) === 0) return reportUploaded();
      return evaluation.finalDecision != null;
    }

    // Nothing selected yet: fall back to the catalog, so a service with no
    // configured regulation at all never blocks the request — it just falls
    // back to the plain Evaluation Report upload.
    if (configured.has(item.serviceItemId)) return false;
    return reportUploaded();
  });
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
        serviceItem: { select: { code: true } },
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (item.request.state !== "ASSESSMENT_RUNNING") {
      return { ok: false, error: "INVALID_STATE" };
    }

    const allowedLabels = evaluationReportLabelsFor(item.serviceItem.code);
    const requestedLabel = formData.get("label");
    const label =
      typeof requestedLabel === "string" && requestedLabel ? requestedLabel : allowedLabels[0];
    if (!allowedLabels.includes(label)) {
      return { ok: false, error: "VALIDATION" };
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
      // is exactly one current document per (request item, label) pair.
      const existing = await tx.requestDocument.findFirst({
        where: { requestItemId: item.id, label },
      });
      const document =
        existing ??
        (await tx.requestDocument.create({
          data: {
            requestId,
            requestItemId: item.id,
            label,
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

const setSaberCertificateUploadedSchema = z.object({
  requestId: z.string().min(1),
  uploaded: z.boolean(),
});

/**
 * PCOC (SAB-001) has no ExternalDeliverable of its own — the certificate is
 * issued directly on the SABER system, not routed through the
 * submit/issue/reject ExternalDeliverable flow above. This is the Evaluator's
 * simple Done/Not done confirmation that it was uploaded, gating REPORT_ISSUED
 * -> CLOSED (see checkTransitionGuards' PCOC block).
 */
export async function setSaberCertificateUploaded(
  input: z.infer<typeof setSaberCertificateUploadedSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = setSaberCertificateUploadedSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };

    const request = await prisma.request.findUnique({
      where: { id: parsed.data.requestId },
      select: { id: true, state: true, organisationId: true },
    });
    if (!request) return { ok: false, error: "NOT_FOUND" };
    if (request.state !== "REPORT_ISSUED") {
      return { ok: false, error: "INVALID_STATE" };
    }

    await prisma.request.update({
      where: { id: request.id },
      data: { saberCertificateUploaded: parsed.data.uploaded },
    });

    await writeAuditLog({
      session,
      organisationId: request.organisationId,
      action: "request.saberCertificateUploaded.set",
      entityType: "Request",
      entityId: request.id,
      after: { uploaded: parsed.data.uploaded },
    });

    revalidatePath(`/[locale]/admin/requests/${request.id}`, "page");
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
  formData: FormData,
): Promise<ActionResult<{ commentId: string }>> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = clientFacingCommentSchema.safeParse({
      requestId: String(formData.get("requestId") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
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

    const { storeCommentAttachment, attachmentToJson } = await import(
      "@/server/comments/attachment"
    );
    let attachment: import("@/server/comments/attachment").CommentAttachment | null =
      null;
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      const stored = await storeCommentAttachment(
        file,
        `orgs/${request.organisationId}/requests/${request.id}/messages`,
      );
      if (!stored.ok) return { ok: false, error: stored.error };
      attachment = stored.attachment;
    }

    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.requestComment.create({
        data: {
          requestId: request.id,
          authorUserId: session.id,
          direction: "ATLAS_TO_CLIENT",
          bodyEn: parsed.data.body,
          bodyAr: parsed.data.body,
          attachments: attachmentToJson(attachment),
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

const setItemAssessmentMethodSchema = z.object({
  requestItemId: z.string().min(1),
  method: z.enum(["AI", "MANUAL"]),
});

/**
 * Lets the Evaluator change a single item's evaluation route after intake
 * already set one (or set one where intake left it blank). The route is a
 * routing preference, not a lock: it decides which workspace the Evaluator is
 * sent to and which action the queue offers first, and both routes remain
 * reachable.
 *
 * Refuses while a run of the *other* method is still in flight. Switching
 * under a live run would leave the evaluator staring at a queue offering the
 * newly-chosen route while `assertNoInFlightRun` keeps bouncing them into the
 * other one — finish or abandon the live run first.
 */
export async function setItemAssessmentMethod(
  input: z.infer<typeof setItemAssessmentMethodSchema>,
): Promise<ActionResult> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");
    const parsed = setItemAssessmentMethodSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "VALIDATION" };
    const { requestItemId, method } = parsed.data;

    const item = await prisma.requestItem.findUnique({
      where: { id: requestItemId },
      select: {
        id: true,
        serviceItemId: true,
        assessmentMethod: true,
        request: { select: { id: true, state: true, organisationId: true } },
      },
    });
    if (!item) return { ok: false, error: "NOT_FOUND" };
    if (item.request.state !== "ASSESSMENT_RUNNING") {
      return { ok: false, error: "INVALID_TRANSITION" };
    }

    const mapping = await prisma.labelEvalServiceMapping.findUnique({
      where: { serviceItemId: item.serviceItemId },
      select: { serviceItemId: true },
    });
    if (!mapping) return { ok: false, error: "VALIDATION" };

    const inFlight = await prisma.labelAssessment.findFirst({
      where: {
        requestItemId,
        status: { in: [...IN_FLIGHT_STATUSES] },
        method: { not: method },
      },
      select: { id: true },
    });
    if (inFlight) return { ok: false, error: "RUN_IN_FLIGHT" };

    await prisma.requestItem.update({
      where: { id: requestItemId },
      data: { assessmentMethod: method },
    });

    await writeAuditLog({
      session,
      action: "request.setItemAssessmentMethod",
      entityType: "RequestItem",
      entityId: requestItemId,
      organisationId: item.request.organisationId,
      before: { assessmentMethod: item.assessmentMethod },
      after: { assessmentMethod: method },
    });

    revalidatePath(`/[locale]/admin/requests/${item.request.id}`, "page");
    revalidatePath("/[locale]/admin/label-evaluator/sfda", "page");
    revalidatePath("/[locale]/admin/label-evaluator/cosmetics", "page");
    return { ok: true, data: undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return { ok: false, error: message };
    }
    return { ok: false, error: "SAVE_FAILED" };
  }
}
