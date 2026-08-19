import type {
  CommentDirection,
  CouponAppliesTo,
  CouponClientScope,
  CouponDiscountType,
  CouponStatus,
  EvaluationActivityStatus,
  EvaluationActivityType,
  FaultAttribution,
  OrganisationStatus,
  Role,
  RequestState,
  ReturnReasonCode,
  UserStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  parseAssessment,
  parseCheckSets,
  type AssessmentState,
  type CheckSet,
} from "@/lib/assessment";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { canTransitionRequest, requirePermission, checkPermission } from "@/lib/rbac";
import { sumBalance } from "@/server/finance/ledger";

/**
 * Single source of truth for request-state transitions available to Atlas
 * staff. Mirrors the workflow described in the product spec — keep this in
 * sync with `src/server/admin/actions.ts` (which imports it directly).
 *
 * `ON_HOLD` outs are empty here; use `allowedTransitionsFor()` so resume
 * targets are derived from `heldFromState`.
 */
export const REQUEST_TRANSITIONS: Record<RequestState, RequestState[]> = {
  DRAFT: [],
  SUBMITTED: [
    "UNDER_INTAKE_REVIEW",
    "RETURNED_TO_CLIENT",
    "ON_HOLD",
    "CANCELLED",
  ],
  UNDER_INTAKE_REVIEW: [
    "ACCEPTED",
    "RETURNED_TO_CLIENT",
    "ON_HOLD",
    "CANCELLED",
  ],
  RETURNED_TO_CLIENT: [],
  ACCEPTED: ["ASSESSMENT_QUEUED", "ON_HOLD", "CANCELLED"],
  ASSESSMENT_QUEUED: ["ASSESSMENT_RUNNING", "ON_HOLD", "CANCELLED"],
  ASSESSMENT_RUNNING: ["TECHNICAL_REVIEW", "ON_HOLD", "CANCELLED"],
  TECHNICAL_REVIEW: ["DECISION", "RETURNED_TO_CLIENT", "ON_HOLD", "CANCELLED"],
  /// CLOSED here is the "Refuse Certification" path — it bypasses REPORT_ISSUED
  /// entirely so a refused request never appears "issued". See
  /// transitionAdminRequest()'s REFUSAL_REASON_REQUIRED / COI gating.
  DECISION: [
    "REPORT_ISSUED",
    "CLOSED",
    "RETURNED_TO_CLIENT",
    "ON_HOLD",
    "CANCELLED",
  ],
  REPORT_ISSUED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
  ON_HOLD: [],
};

/**
 * SCOC (Shipment Conformity Certificate) — the deliverable is an externally
 * issued certificate (SABER for SAB-002, SFDA for the cosmetics equivalent)
 * the Evaluator uploads (see ExternalDeliverablePanel), with no
 * Atlas-authored technical content to review, so a request made up entirely
 * of SCOC items skips TECHNICAL_REVIEW: the Evaluator's "Complete Evaluation"
 * hands straight to the Decision Maker. A request bundling SCOC with any
 * other service still goes through the normal REQUEST_TRANSITIONS graph
 * below.
 */
const SCOC_SERVICE_CODES = ["SAB-002", "SFDA-COS-002"];

export function isScocOnlyRequest(serviceCodes: string[]): boolean {
  return serviceCodes.length > 0 && serviceCodes.every((c) => SCOC_SERVICE_CODES.includes(c));
}

/**
 * Lab Testing Coordination has no Atlas-authored technical content to review
 * or certify — the deliverable is the external lab's own test report — so an
 * all-LAB-001 request skips TECHNICAL_REVIEW *and* DECISION entirely: the
 * Evaluator's one-click "Complete Testing" (completeLabTesting) hands
 * ASSESSMENT_RUNNING straight to REPORT_ISSUED (then CLOSED in the same
 * transaction). A request bundling LAB-001 with any other service still goes
 * through the normal REQUEST_TRANSITIONS graph below.
 */
export const LAB_TESTING_SERVICE_CODE = "LAB-001";

export function isLabTestingOnlyRequest(serviceCodes: string[]): boolean {
  return serviceCodes.length > 0 && serviceCodes.every((c) => c === LAB_TESTING_SERVICE_CODE);
}

/** Safe default when a hold has no recorded prior state (legacy rows). */
const ON_HOLD_RESUME_FALLBACK: RequestState = "UNDER_INTAKE_REVIEW";

/**
 * Terminal states from which a request may be reopened. Reopening is a
 * deliberate exception to the forward-only `REQUEST_TRANSITIONS` graph —
 * modeled separately (via `RequestReopenRequest`) rather than folded into it,
 * so ordinary staff transitions stay auditable and simple.
 */
export const REOPENABLE_STATES: RequestState[] = ["CLOSED", "CANCELLED"];

/** Active stages a reopened request may resume into. Excludes DRAFT, ON_HOLD, and the terminal states themselves. */
export const REOPEN_TARGET_STATES: RequestState[] = [
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
];

export function canReopenRequest(state: RequestState): boolean {
  return REOPENABLE_STATES.includes(state);
}

/**
 * Resolves staff-visible transition targets for a request, including ON_HOLD
 * resume (heldFromState or UNDER_INTAKE_REVIEW) plus CANCELLED.
 */
export function allowedTransitionsFor(request: {
  state: RequestState;
  heldFromState: RequestState | null;
  /** ServiceItem.code of every item on the request; drives the SCOC skip above. */
  serviceCodes?: string[];
}): RequestState[] {
  if (request.state === "ON_HOLD") {
    const resume = request.heldFromState ?? ON_HOLD_RESUME_FALLBACK;
    return [resume, "CANCELLED"];
  }
  if (
    request.state === "ASSESSMENT_RUNNING" &&
    isScocOnlyRequest(request.serviceCodes ?? [])
  ) {
    return ["DECISION", "ON_HOLD", "CANCELLED"];
  }
  if (
    request.state === "ASSESSMENT_RUNNING" &&
    isLabTestingOnlyRequest(request.serviceCodes ?? [])
  ) {
    // No forward entry here — completion only happens through the dedicated
    // completeLabTesting composite action (which enforces LAB_REPORT_REQUIRED
    // and cascades straight to CLOSED), never the generic transition button.
    return ["ON_HOLD", "CANCELLED"];
  }
  return REQUEST_TRANSITIONS[request.state] ?? [];
}

export function onHoldResumeTarget(
  heldFromState: RequestState | null,
): RequestState {
  return heldFromState ?? ON_HOLD_RESUME_FALLBACK;
}

/** States counted towards the admin shell "open work" badge. */
const QUEUE_DEPTH_STATES: RequestState[] = [
  "SUBMITTED",
  "UNDER_INTAKE_REVIEW",
  "ACCEPTED",
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  "TECHNICAL_REVIEW",
  "DECISION",
  "ON_HOLD",
];

/** States excluded from the "open request" shortlist / counts. */
const CLOSED_LIKE_STATES: RequestState[] = [
  "DRAFT",
  "CLOSED",
  "CANCELLED",
  "REPORT_ISSUED",
];

export const ADMIN_QUEUE_STATES = {
  intake: ["SUBMITTED", "UNDER_INTAKE_REVIEW"],
  assessment: ["ACCEPTED", "ASSESSMENT_QUEUED", "ASSESSMENT_RUNNING"],
  technical: ["TECHNICAL_REVIEW"],
  decision: ["DECISION"],
  returned: ["RETURNED_TO_CLIENT"],
  onHold: ["ON_HOLD"],
} satisfies Record<string, RequestState[]>;

export type AdminQueueKey = keyof typeof ADMIN_QUEUE_STATES;

function isAdminQueueKey(value: string): value is AdminQueueKey {
  return value in ADMIN_QUEUE_STATES;
}

// ─── getAdminQueueCounts ─────────────────────────────────────────────────────

export type AdminQueueCounts = Record<AdminQueueKey, number>;

export async function getAdminQueueCounts(): Promise<AdminQueueCounts | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const keys = Object.keys(ADMIN_QUEUE_STATES) as AdminQueueKey[];
    const counts = await Promise.all(
      keys.map((key) =>
        prisma.request.count({ where: { state: { in: ADMIN_QUEUE_STATES[key] } } }),
      ),
    );

    return keys.reduce((acc, key, index) => {
      acc[key] = counts[index];
      return acc;
    }, {} as AdminQueueCounts);
  } catch {
    return null;
  }
}

// ─── getAdminShellChrome ─────────────────────────────────────────────────────

export type AdminShellChrome = {
  queueDepth: number;
  newRequestsCount: number;
  requests: Array<{ id: string; requestNo: string; productName: string }>;
  clients: Array<{ id: string; name: string }>;
};

const EMPTY_SHELL_CHROME: AdminShellChrome = {
  queueDepth: 0,
  newRequestsCount: 0,
  requests: [],
  clients: [],
};

/** Requests nobody has started work on yet — drives the sidebar "Requests" badge. */
export const NEW_REQUEST_STATES: RequestState[] = ["SUBMITTED"];

export async function getAdminShellChrome(
  locale: "ar" | "en",
): Promise<AdminShellChrome> {
  try {
    const session = await requireSession();
    requirePermission(session, "admin:dashboard");

    const canRequests = checkPermission(session, "requests:admin");
    const canClients = checkPermission(session, "clients:read");

    const [queueDepth, newRequestsCount, requests, clients] = await Promise.all([
      canRequests
        ? prisma.request.count({
            where: { state: { in: QUEUE_DEPTH_STATES } },
          })
        : Promise.resolve(0),
      canRequests
        ? prisma.request.count({
            where: { state: { in: NEW_REQUEST_STATES } },
          })
        : Promise.resolve(0),
      canRequests
        ? prisma.request.findMany({
            where: { state: { notIn: CLOSED_LIKE_STATES } },
            orderBy: { updatedAt: "desc" },
            take: 8,
            select: {
              id: true,
              requestNo: true,
              items: {
                orderBy: { sortOrder: "asc" },
                take: 1,
                select: { productNameEn: true, productNameAr: true },
              },
            },
          })
        : Promise.resolve([]),
      canClients
        ? prisma.organisation.findMany({
            where: { type: "CLIENT" },
            orderBy: { nameEn: "asc" },
            select: { id: true, nameEn: true, nameAr: true },
          })
        : Promise.resolve([]),
    ]);

    return {
      queueDepth,
      newRequestsCount,
      requests: requests.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        productName:
          (locale === "ar" ? r.items[0]?.productNameAr : r.items[0]?.productNameEn) ??
          "",
      })),
      clients: clients.map((c) => ({
        id: c.id,
        name: locale === "ar" ? c.nameAr : c.nameEn,
      })),
    };
  } catch {
    return EMPTY_SHELL_CHROME;
  }
}

// ─── listAdminRequests ───────────────────────────────────────────────────────

export type AdminRequestListItem = {
  id: string;
  requestNo: string;
  productNameEn: string;
  productNameAr: string;
  state: RequestState;
  slaDueAt: string | null;
  submittedAt: string | null;
  updatedAt: string;
  organisationId: string;
  orgNameEn: string;
  orgNameAr: string;
  serviceNameEn: string;
  serviceNameAr: string;
  extraItemCount: number;
  unreadClientMessages: number;
};

export type AdminRequestListResult = {
  rows: AdminRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listAdminRequests(input: {
  q?: string | null;
  state?: string | null;
  queue?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<AdminRequestListResult | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, input.pageSize ?? 20));
    const q = input.q?.trim() || "";

    const where: Prisma.RequestWhereInput = {};

    if (input.state && input.state !== "ALL") {
      where.state = input.state as RequestState;
    } else if (input.queue && isAdminQueueKey(input.queue)) {
      where.state = { in: ADMIN_QUEUE_STATES[input.queue] };
    }

    if (q) {
      where.OR = [
        { requestNo: { contains: q, mode: "insensitive" } },
        {
          items: {
            some: {
              OR: [
                { productNameEn: { contains: q, mode: "insensitive" } },
                { productNameAr: { contains: q, mode: "insensitive" } },
              ],
            },
          },
        },
        { organisation: { nameEn: { contains: q, mode: "insensitive" } } },
        { organisation: { nameAr: { contains: q, mode: "insensitive" } } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.request.count({ where }),
      prisma.request.findMany({
        where,
        include: {
          organisation: { select: { nameEn: true, nameAr: true } },
          items: {
            orderBy: { sortOrder: "asc" },
            include: { serviceItem: { select: { nameEn: true, nameAr: true } } },
          },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const unreadCounts = rows.length
      ? await prisma.requestComment.groupBy({
          by: ["requestId"],
          where: {
            requestId: { in: rows.map((r) => r.id) },
            direction: "CLIENT_TO_ATLAS",
            readAt: null,
          },
          _count: { _all: true },
        })
      : [];
    const unreadByRequestId = new Map(
      unreadCounts.map((u) => [u.requestId, u._count._all]),
    );

    return {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      rows: rows.map((r) => {
        const first = r.items[0];
        return {
          id: r.id,
          requestNo: r.requestNo,
          productNameEn: first?.productNameEn ?? "",
          productNameAr: first?.productNameAr ?? "",
          state: r.state,
          slaDueAt: r.slaDueAt?.toISOString() ?? null,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
          organisationId: r.organisationId,
          orgNameEn: r.organisation.nameEn,
          orgNameAr: r.organisation.nameAr,
          serviceNameEn: first?.serviceItem.nameEn ?? "",
          serviceNameAr: first?.serviceItem.nameAr ?? "",
          extraItemCount: Math.max(0, r.items.length - 1),
          unreadClientMessages: unreadByRequestId.get(r.id) ?? 0,
        };
      }),
    };
  } catch {
    return null;
  }
}

// ─── getAdminRequestDetail ───────────────────────────────────────────────────

export type AdminRequestDetailItem = {
  id: string;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
  serviceItem: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    slaHours: number;
    maxResubmissions: number;
    checkSets: CheckSet[];
    requiresInspection: boolean;
    requiresLabTesting: boolean;
    requiresFactoryAudit: boolean;
    deliverableType: "INTERNAL_REPORT" | "EXTERNAL_CERTIFICATE";
    deliverableEn: string | null;
    deliverableAr: string | null;
  };
  externalDeliverable: {
    id: string;
    status: "PENDING_SUBMISSION" | "SUBMITTED" | "ISSUED" | "REJECTED";
    externalRefType: string;
    externalRefValue: string | null;
    submittedAt: string | null;
    issuedAt: string | null;
    notes: string | null;
    files: Array<{ id: string; fileName: string; storageKey: string }>;
  } | null;
  assessment: AssessmentState;
  documents: Array<{
    id: string;
    label: string;
    requiredDocumentId: string | null;
    currentVersion: {
      id: string;
      version: number;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
      uploadedByNameEn: string;
      uploadedByNameAr: string;
      uploadedAt: string;
    } | null;
    versions: Array<{
      id: string;
      version: number;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
      uploadedByNameEn: string;
      uploadedByNameAr: string;
      uploadedAt: string;
    }>;
  }>;
  activities: Array<{
    id: string;
    type: EvaluationActivityType;
    status: EvaluationActivityStatus;
    scheduledDate: string | null;
    assignedUserId: string | null;
    assignedUserNameEn: string | null;
    assignedUserNameAr: string | null;
    qualificationNote: string | null;
    notes: string | null;
    /** LABORATORY_TESTING only. */
    laboratoryId: string | null;
    laboratoryNameEn: string | null;
    laboratoryNameAr: string | null;
    sampleTrackingNo: string | null;
    sampleCarrier: string | null;
    sampleSentAt: string | null;
    sampleReceivedAt: string | null;
    reports: Array<{
      id: string;
      fileName: string;
      storageKey: string;
      uploadedAt: string;
    }>;
  }>;
  /** Admin-curated "required tests" checklist (LAB-001 only). */
  requiredTests: Array<{
    id: string;
    testTypeId: string | null;
    testTypeNameEn: string | null;
    testTypeNameAr: string | null;
    customLabel: string | null;
    notes: string | null;
  }>;
};

export type AdminRequestDetail = {
  id: string;
  requestNo: string;
  state: RequestState;
  submissionNo: number;
  priceCharged: number;
  discountApplied: number;
  couponCode: string | null;
  slaDueAt: string | null;
  submittedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  heldFromState: RequestState | null;
  allowedTransitions: RequestState[];
  canReopen: boolean;
  reopenTargetStates: RequestState[];
  pendingReopenRequest: {
    id: string;
    reason: string;
    requestedAt: string;
    requestedByNameEn: string;
    requestedByNameAr: string;
  } | null;
  organisation: {
    id: string;
    nameEn: string;
    nameAr: string;
    email: string;
    phone: string | null;
  };
  items: AdminRequestDetailItem[];
  /** Doc's reviewer meta-checklist — global definition + this request's results. */
  technicalReviewChecklist: {
    checkSets: CheckSet[];
    results: AssessmentState;
  };
  createdBy: { id: string; fullNameEn: string; fullNameAr: string; email: string };
  assignedTo: {
    id: string;
    fullNameEn: string;
    fullNameAr: string;
    email: string;
  } | null;
  events: Array<{
    id: string;
    fromState: RequestState | null;
    toState: RequestState;
    actorNameEn: string;
    actorNameAr: string;
    actorRole: Role;
    note: string | null;
    reasonCodes: ReturnReasonCode[];
    faultAttribution: FaultAttribution | null;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    bodyEn: string | null;
    bodyAr: string | null;
    direction: CommentDirection;
    authorNameEn: string;
    authorNameAr: string;
    createdAt: string;
    mentions: Array<{ userId: string; nameEn: string; nameAr: string }>;
    attachments: CommentAttachment[];
  }>;
};

export type CommentAttachment = {
  fileName: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
};

/** Coerce arbitrary JSON (Prisma) into a well-formed attachment list. */
export function parseCommentAttachments(raw: unknown): CommentAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: CommentAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as Record<string, unknown>;
    if (typeof a.fileName !== "string" || typeof a.storageKey !== "string") continue;
    out.push({
      fileName: a.fileName,
      storageKey: a.storageKey,
      sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : 0,
      mimeType: typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream",
    });
  }
  return out;
}

export async function getAdminRequestDetail(
  id: string,
): Promise<AdminRequestDetail | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const request = await prisma.request.findUnique({
      where: { id },
      include: {
        organisation: {
          select: { id: true, nameEn: true, nameAr: true, email: true, phone: true },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            serviceItem: {
              select: {
                id: true,
                code: true,
                nameEn: true,
                nameAr: true,
                slaHours: true,
                maxResubmissions: true,
                checkSets: true,
                requiresInspection: true,
                requiresLabTesting: true,
                requiresFactoryAudit: true,
                deliverableType: true,
                deliverableEn: true,
                deliverableAr: true,
              },
            },
            externalDeliverables: {
              include: {
                documents: {
                  where: { currentVersionId: { not: null } },
                  include: { currentVersion: true },
                  orderBy: { createdAt: "asc" },
                },
              },
              orderBy: { createdAt: "asc" },
            },
            documents: {
              // Evaluation-activity / external-deliverable files render in
              // their own panels below, not the generic document list.
              where: { activityId: null, externalDeliverableId: null },
              include: {
                versions: {
                  include: {
                    uploadedBy: { select: { fullNameEn: true, fullNameAr: true } },
                  },
                  orderBy: { version: "asc" },
                },
                currentVersion: {
                  include: {
                    uploadedBy: { select: { fullNameEn: true, fullNameAr: true } },
                  },
                },
              },
              orderBy: { createdAt: "asc" },
            },
            activities: {
              include: {
                assignedUser: { select: { fullNameEn: true, fullNameAr: true } },
                laboratory: { select: { id: true, nameEn: true, nameAr: true } },
                documents: {
                  where: { currentVersionId: { not: null } },
                  include: { currentVersion: true },
                  orderBy: { createdAt: "asc" },
                },
              },
              orderBy: { createdAt: "asc" },
            },
            requiredTests: {
              include: {
                testType: { select: { nameEn: true, nameAr: true } },
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        createdBy: {
          select: { id: true, fullNameEn: true, fullNameAr: true, email: true },
        },
        assignedTo: {
          select: { id: true, fullNameEn: true, fullNameAr: true, email: true },
        },
        events: {
          include: { actor: { select: { fullNameEn: true, fullNameAr: true } } },
          orderBy: { createdAt: "asc" },
        },
        comments: {
          include: {
            author: { select: { fullNameEn: true, fullNameAr: true } },
            mentions: {
              include: {
                user: { select: { id: true, fullNameEn: true, fullNameAr: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        reopenRequests: {
          where: { status: "PENDING" },
          include: {
            requestedBy: { select: { fullNameEn: true, fullNameAr: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!request) return null;

    const pendingReopenRequest = request.reopenRequests[0] ?? null;
    const technicalReviewChecklistDefinition =
      await prisma.technicalReviewChecklist.findUnique({
        where: { id: "singleton" },
      });

    return {
      id: request.id,
      requestNo: request.requestNo,
      state: request.state,
      submissionNo: request.submissionNo,
      priceCharged: toNumber(request.priceCharged),
      discountApplied: toNumber(request.discountApplied),
      couponCode: request.couponCode,
      slaDueAt: request.slaDueAt?.toISOString() ?? null,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      closedAt: request.closedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      heldFromState: request.heldFromState,
      allowedTransitions: allowedTransitionsFor({
        state: request.state,
        heldFromState: request.heldFromState,
        serviceCodes: request.items.map((i) => i.serviceItem.code),
      }).filter((toState) =>
        canTransitionRequest(session, toState, {
          fromState: request.state,
          heldFromState: request.heldFromState,
        }),
      ),
      canReopen: canReopenRequest(request.state) && !pendingReopenRequest,
      reopenTargetStates: REOPEN_TARGET_STATES,
      pendingReopenRequest: pendingReopenRequest
        ? {
            id: pendingReopenRequest.id,
            reason: pendingReopenRequest.reason,
            requestedAt: pendingReopenRequest.createdAt.toISOString(),
            requestedByNameEn: pendingReopenRequest.requestedBy.fullNameEn,
            requestedByNameAr: pendingReopenRequest.requestedBy.fullNameAr,
          }
        : null,
      organisation: request.organisation,
      items: request.items.map((item) => ({
        id: item.id,
        productNameEn: item.productNameEn,
        productNameAr: item.productNameAr,
        brand: item.brand,
        productAttrs:
          item.productAttrs && typeof item.productAttrs === "object"
            ? (item.productAttrs as Record<string, unknown>)
            : {},
        serviceItem: {
          id: item.serviceItem.id,
          code: item.serviceItem.code,
          nameEn: item.serviceItem.nameEn,
          nameAr: item.serviceItem.nameAr,
          slaHours: item.serviceItem.slaHours,
          maxResubmissions: item.serviceItem.maxResubmissions,
          checkSets: parseCheckSets(item.serviceItem.checkSets),
          requiresInspection: item.serviceItem.requiresInspection,
          requiresLabTesting: item.serviceItem.requiresLabTesting,
          requiresFactoryAudit: item.serviceItem.requiresFactoryAudit,
          deliverableType: item.serviceItem.deliverableType,
          deliverableEn: item.serviceItem.deliverableEn,
          deliverableAr: item.serviceItem.deliverableAr,
        },
        externalDeliverable: item.externalDeliverables[0]
          ? {
              id: item.externalDeliverables[0].id,
              status: item.externalDeliverables[0].status,
              externalRefType: item.externalDeliverables[0].externalRefType,
              externalRefValue: item.externalDeliverables[0].externalRefValue,
              submittedAt:
                item.externalDeliverables[0].submittedAt?.toISOString() ?? null,
              issuedAt: item.externalDeliverables[0].issuedAt?.toISOString() ?? null,
              notes: item.externalDeliverables[0].notes,
              files: item.externalDeliverables[0].documents
                .filter((d) => d.currentVersion)
                .map((d) => ({
                  id: d.id,
                  fileName: d.currentVersion!.fileName,
                  storageKey: d.currentVersion!.storageKey,
                })),
            }
          : null,
        assessment: parseAssessment(item.assessment),
        documents: item.documents.map((d) => ({
          id: d.id,
          label: d.label,
          requiredDocumentId: d.requiredDocumentId,
          currentVersion: d.currentVersion
            ? {
                id: d.currentVersion.id,
                version: d.currentVersion.version,
                fileName: d.currentVersion.fileName,
                mimeType: d.currentVersion.mimeType,
                sizeBytes: d.currentVersion.sizeBytes,
                storageKey: d.currentVersion.storageKey,
                uploadedByNameEn: d.currentVersion.uploadedBy.fullNameEn,
                uploadedByNameAr: d.currentVersion.uploadedBy.fullNameAr,
                uploadedAt: d.currentVersion.uploadedAt.toISOString(),
              }
            : null,
          versions: d.versions.map((v) => ({
            id: v.id,
            version: v.version,
            fileName: v.fileName,
            mimeType: v.mimeType,
            sizeBytes: v.sizeBytes,
            storageKey: v.storageKey,
            uploadedByNameEn: v.uploadedBy.fullNameEn,
            uploadedByNameAr: v.uploadedBy.fullNameAr,
            uploadedAt: v.uploadedAt.toISOString(),
          })),
        })),
        activities: item.activities.map((a) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          scheduledDate: a.scheduledDate?.toISOString() ?? null,
          assignedUserId: a.assignedUserId,
          assignedUserNameEn: a.assignedUser?.fullNameEn ?? null,
          assignedUserNameAr: a.assignedUser?.fullNameAr ?? null,
          qualificationNote: a.qualificationNote,
          notes: a.notes,
          laboratoryId: a.laboratoryId,
          laboratoryNameEn: a.laboratory?.nameEn ?? null,
          laboratoryNameAr: a.laboratory?.nameAr ?? null,
          sampleTrackingNo: a.sampleTrackingNo,
          sampleCarrier: a.sampleCarrier,
          sampleSentAt: a.sampleSentAt?.toISOString() ?? null,
          sampleReceivedAt: a.sampleReceivedAt?.toISOString() ?? null,
          reports: a.documents
            .filter((d) => d.currentVersion)
            .map((d) => ({
              id: d.id,
              fileName: d.currentVersion!.fileName,
              storageKey: d.currentVersion!.storageKey,
              uploadedAt: d.currentVersion!.uploadedAt.toISOString(),
            })),
        })),
        requiredTests: item.requiredTests.map((rt) => ({
          id: rt.id,
          testTypeId: rt.testTypeId,
          testTypeNameEn: rt.testType?.nameEn ?? null,
          testTypeNameAr: rt.testType?.nameAr ?? null,
          customLabel: rt.customLabel,
          notes: rt.notes,
        })),
      })),
      technicalReviewChecklist: {
        checkSets: parseCheckSets(technicalReviewChecklistDefinition?.checkSets),
        results: parseAssessment(request.technicalReviewChecklist),
      },
      createdBy: request.createdBy,
      assignedTo: request.assignedTo,
      events: request.events.map((e) => ({
        id: e.id,
        fromState: e.fromState,
        toState: e.toState,
        actorNameEn: e.actor.fullNameEn,
        actorNameAr: e.actor.fullNameAr,
        actorRole: e.actorRole,
        note: e.note,
        reasonCodes: e.reasonCodes,
        faultAttribution: e.faultAttribution,
        createdAt: e.createdAt.toISOString(),
      })),
      comments: request.comments.map((c) => ({
        id: c.id,
        bodyEn: c.bodyEn,
        bodyAr: c.bodyAr,
        direction: c.direction,
        authorNameEn: c.author.fullNameEn,
        authorNameAr: c.author.fullNameAr,
        createdAt: c.createdAt.toISOString(),
        mentions: c.mentions.map((m) => ({
          userId: m.userId,
          nameEn: m.user.fullNameEn,
          nameAr: m.user.fullNameAr,
        })),
        attachments: parseCommentAttachments(c.attachments),
      })),
    };
  } catch {
    return null;
  }
}

// ─── listAdminClients ────────────────────────────────────────────────────────

const OPEN_REQUEST_EXCLUDED_STATES: RequestState[] = [
  "DRAFT",
  "CLOSED",
  "CANCELLED",
];

export type AdminClientListItem = {
  id: string;
  nameEn: string;
  nameAr: string;
  email: string;
  status: OrganisationStatus;
  balance: number;
  creditLimit: number;
  openRequestCount: number;
  createdAt: string;
};

export type AdminClientListResult = {
  rows: AdminClientListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export type OnBehalfClientOption = {
  id: string;
  nameEn: string;
  nameAr: string;
  email: string;
};

/**
 * Active client organisations for the "new request on behalf" picker. Gated by
 * the same permission that lets staff act on a client's behalf.
 */
export async function listClientsForOnBehalf(): Promise<
  OnBehalfClientOption[] | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:create-behalf");

    const orgs = await prisma.organisation.findMany({
      where: { type: "CLIENT", status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
      select: { id: true, nameEn: true, nameAr: true, email: true },
    });
    return orgs;
  } catch {
    return null;
  }
}

export async function listAdminClients(input: {
  q?: string | null;
  page?: number;
}): Promise<AdminClientListResult | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "clients:read");

    const page = Math.max(1, input.page ?? 1);
    const pageSize = 20;
    const q = input.q?.trim() || "";

    const where: Prisma.OrganisationWhereInput = {
      type: "CLIENT",
      ...(q
        ? {
            OR: [
              { nameEn: { contains: q, mode: "insensitive" } },
              { nameAr: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { crNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, orgs] = await Promise.all([
      prisma.organisation.count({ where }),
      prisma.organisation.findMany({
        where,
        include: {
          ledgerEntries: { select: { debit: true, credit: true } },
          _count: {
            select: {
              requests: {
                where: { state: { notIn: OPEN_REQUEST_EXCLUDED_STATES } },
              },
            },
          },
        },
        orderBy: { nameEn: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      rows: orgs.map((o) => ({
        id: o.id,
        nameEn: o.nameEn,
        nameAr: o.nameAr,
        email: o.email,
        status: o.status,
        balance: toNumber(sumBalance(o.ledgerEntries)),
        creditLimit: toNumber(o.creditLimit),
        openRequestCount: o._count.requests,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  } catch {
    return null;
  }
}

// ─── getAdminClientDetail ────────────────────────────────────────────────────

export type AdminClientDetail = {
  id: string;
  nameEn: string;
  nameAr: string;
  email: string;
  phone: string | null;
  website: string | null;
  crNumber: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  nationalAddress: string | null;
  status: OrganisationStatus;
  /** True when caller has clients:finance — UI gates balance / ledger. */
  canViewFinance: boolean;
  creditLimit: number;
  autoHoldWhenOverLimit: boolean;
  paymentTermsDays: number;
  balance: number;
  createdAt: string;
  users: Array<{
    id: string;
    email: string;
    fullNameEn: string;
    fullNameAr: string;
    status: string;
    roles: Role[];
    lastLoginAt: string | null;
  }>;
  recentRequests: Array<{
    id: string;
    requestNo: string;
    productNameEn: string;
    productNameAr: string;
    state: RequestState;
    updatedAt: string;
  }>;
  recentLedger: Array<{
    id: string;
    entryDate: string;
    type: string;
    debit: number;
    credit: number;
    descriptionEn: string;
    descriptionAr: string;
  }>;
};

export async function getAdminClientDetail(
  id: string,
): Promise<AdminClientDetail | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "clients:read");
    const canViewFinance = checkPermission(session, "clients:finance");

    const org = await prisma.organisation.findFirst({
      where: { id, type: "CLIENT" },
    });
    if (!org) return null;

    const [ledgerAll, users, recentRequests, recentLedger] = await Promise.all([
      canViewFinance
        ? prisma.ledgerEntry.findMany({
            where: { organisationId: org.id },
            select: { debit: true, credit: true },
          })
        : Promise.resolve([] as Array<{ debit: Prisma.Decimal; credit: Prisma.Decimal }>),
      prisma.user.findMany({
        where: { organisationId: org.id },
        include: { roles: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.request.findMany({
        where: { organisationId: org.id },
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: {
          id: true,
          requestNo: true,
          state: true,
          updatedAt: true,
          items: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            select: { productNameEn: true, productNameAr: true },
          },
        },
      }),
      canViewFinance
        ? prisma.ledgerEntry.findMany({
            where: { organisationId: org.id },
            orderBy: { entryDate: "desc" },
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    return {
      id: org.id,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      email: org.email,
      phone: org.phone,
      website: org.website,
      crNumber: org.crNumber,
      vatNumber: org.vatNumber,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      city: org.city,
      region: org.region,
      postalCode: org.postalCode,
      country: org.country,
      nationalAddress: org.nationalAddress,
      status: org.status,
      canViewFinance,
      creditLimit: canViewFinance ? toNumber(org.creditLimit) : 0,
      autoHoldWhenOverLimit: canViewFinance ? org.autoHoldWhenOverLimit : false,
      paymentTermsDays: canViewFinance ? org.paymentTermsDays : 0,
      balance: canViewFinance ? toNumber(sumBalance(ledgerAll)) : 0,
      createdAt: org.createdAt.toISOString(),
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        fullNameEn: u.fullNameEn,
        fullNameAr: u.fullNameAr,
        status: u.status,
        roles: u.roles.map((r) => r.role),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      recentRequests: recentRequests.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        productNameEn: r.items[0]?.productNameEn ?? "",
        productNameAr: r.items[0]?.productNameAr ?? "",
        state: r.state,
        updatedAt: r.updatedAt.toISOString(),
      })),
      recentLedger: canViewFinance
        ? recentLedger.map((l) => ({
            id: l.id,
            entryDate: l.entryDate.toISOString(),
            type: l.type,
            debit: toNumber(l.debit),
            credit: toNumber(l.credit),
            descriptionEn: l.descriptionEn,
            descriptionAr: l.descriptionAr,
          }))
        : [],
    };
  } catch {
    return null;
  }
}

// ─── listAdminCatalogue ──────────────────────────────────────────────────────

export type AdminCatalogueItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  active: boolean;
  basePrice: number;
  vatRate: number;
  slaHours: number;
  resubmissionPricePct: number;
  freeResubmissions: number;
  maxResubmissions: number;
  sortOrder: number;
  requiresInspection: boolean;
  requiresLabTesting: boolean;
  requiresFactoryAudit: boolean;
  subCategoryId: string;
  subCategoryNameEn: string;
  subCategoryNameAr: string;
  mainCategoryId: string;
  mainCategoryNameEn: string;
  mainCategoryNameAr: string;
  defaultEvaluatorId: string | null;
  defaultEvaluatorNameEn: string | null;
  defaultEvaluatorNameAr: string | null;
  requiredDocuments: Array<{
    id: string;
    nameEn: string;
    nameAr: string;
    mandatory: boolean;
    templateFileName: string | null;
  }>;
};

export async function listAdminCatalogue(): Promise<AdminCatalogueItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const items = await prisma.serviceItem.findMany({
      include: {
        subCategory: { include: { mainCategory: true } },
        defaultEvaluator: { select: { fullNameEn: true, fullNameAr: true } },
        requiredDocuments: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: [{ subCategoryId: "asc" }, { sortOrder: "asc" }],
    });

    return items.map((item) => ({
      id: item.id,
      code: item.code,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      descEn: item.descEn ?? "",
      descAr: item.descAr ?? "",
      active: item.active,
      basePrice: toNumber(item.basePrice),
      vatRate: toNumber(item.vatRate),
      slaHours: item.slaHours,
      resubmissionPricePct: toNumber(item.resubmissionPricePct),
      freeResubmissions: item.freeResubmissions,
      maxResubmissions: item.maxResubmissions,
      sortOrder: item.sortOrder,
      requiresInspection: item.requiresInspection,
      requiresLabTesting: item.requiresLabTesting,
      requiresFactoryAudit: item.requiresFactoryAudit,
      subCategoryId: item.subCategoryId,
      subCategoryNameEn: item.subCategory.nameEn,
      subCategoryNameAr: item.subCategory.nameAr,
      mainCategoryId: item.subCategory.mainCategoryId,
      mainCategoryNameEn: item.subCategory.mainCategory.nameEn,
      mainCategoryNameAr: item.subCategory.mainCategory.nameAr,
      defaultEvaluatorId: item.defaultEvaluatorId,
      defaultEvaluatorNameEn: item.defaultEvaluator?.fullNameEn ?? null,
      defaultEvaluatorNameAr: item.defaultEvaluator?.fullNameAr ?? null,
      requiredDocuments: item.requiredDocuments.map((d) => ({
        id: d.id,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        mandatory: d.mandatory,
        templateFileName: d.templateFileName,
      })),
    }));
  } catch {
    return null;
  }
}

export type AdminLaboratoryItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  accreditationScopeEn: string;
  accreditationScopeAr: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  active: boolean;
  sortOrder: number;
};

export async function listLaboratories(): Promise<AdminLaboratoryItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");

    const labs = await prisma.laboratory.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });

    return labs.map((lab) => ({
      id: lab.id,
      code: lab.code,
      nameEn: lab.nameEn,
      nameAr: lab.nameAr,
      accreditationScopeEn: lab.accreditationScopeEn ?? "",
      accreditationScopeAr: lab.accreditationScopeAr ?? "",
      contactName: lab.contactName ?? "",
      contactEmail: lab.contactEmail ?? "",
      contactPhone: lab.contactPhone ?? "",
      active: lab.active,
      sortOrder: lab.sortOrder,
    }));
  } catch {
    return null;
  }
}

/** Active laboratories only, for the request-detail lab picker. */
export async function listActiveLaboratories(): Promise<
  Array<{ id: string; nameEn: string; nameAr: string }> | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    return await prisma.laboratory.findMany({
      where: { active: true },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
  } catch {
    return null;
  }
}

export type AdminTestTypeItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  active: boolean;
  sortOrder: number;
};

export async function listTestTypes(): Promise<AdminTestTypeItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "laboratories:manage");

    const testTypes = await prisma.testType.findMany({
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });

    return testTypes.map((t) => ({
      id: t.id,
      code: t.code,
      nameEn: t.nameEn,
      nameAr: t.nameAr,
      descEn: t.descEn ?? "",
      descAr: t.descAr ?? "",
      active: t.active,
      sortOrder: t.sortOrder,
    }));
  } catch {
    return null;
  }
}

/** Active test types only, for the request-detail required-tests picker. */
export async function listActiveTestTypes(): Promise<
  Array<{ id: string; nameEn: string; nameAr: string }> | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    return await prisma.testType.findMany({
      where: { active: true },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
  } catch {
    return null;
  }
}

/** Active Evaluator users, for the catalogue's default-evaluator routing picker. */
export async function listActiveEvaluators(): Promise<
  Array<{ id: string; fullNameEn: string; fullNameAr: string }> | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    return await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        organisation: { type: "ATLAS" },
        roles: { some: { role: "EVALUATOR" } },
      },
      select: { id: true, fullNameEn: true, fullNameAr: true },
      orderBy: { fullNameEn: "asc" },
    });
  } catch {
    return null;
  }
}

// ─── listAdminCategoryTree ───────────────────────────────────────────────────

export type AdminCategoryTreeNode = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string;
  descAr: string;
  sortOrder: number;
  subCategories: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    descEn: string;
    descAr: string;
    sortOrder: number;
  }>;
};

export async function listAdminCategoryTree(): Promise<
  AdminCategoryTreeNode[] | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const mains = await prisma.mainCategory.findMany({
      where: { active: true },
      include: {
        subCategories: {
          where: { active: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return mains.map((main) => ({
      id: main.id,
      code: main.code,
      nameEn: main.nameEn,
      nameAr: main.nameAr,
      descEn: main.descEn ?? "",
      descAr: main.descAr ?? "",
      sortOrder: main.sortOrder,
      subCategories: main.subCategories.map((sub) => ({
        id: sub.id,
        code: sub.code,
        nameEn: sub.nameEn,
        nameAr: sub.nameAr,
        descEn: sub.descEn ?? "",
        descAr: sub.descAr ?? "",
        sortOrder: sub.sortOrder,
      })),
    }));
  } catch {
    return null;
  }
}

// ─── listAdminCoupons ────────────────────────────────────────────────────────

export type AdminCouponItem = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  discountType: CouponDiscountType;
  value: number;
  status: CouponStatus;
  appliesTo: CouponAppliesTo;
  clientScope: CouponClientScope;
  validFrom: string;
  validTo: string;
  usedCount: number;
  totalUsageLimit: number | null;
  createdAt: string;
};

export async function listAdminCoupons(): Promise<AdminCouponItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");

    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
    });

    return coupons.map((c) => ({
      id: c.id,
      code: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      discountType: c.discountType,
      value: toNumber(c.value),
      status: c.status,
      appliesTo: c.appliesTo,
      clientScope: c.clientScope,
      validFrom: c.validFrom.toISOString(),
      validTo: c.validTo.toISOString(),
      usedCount: c.usedCount,
      totalUsageLimit: c.totalUsageLimit,
      createdAt: c.createdAt.toISOString(),
    }));
  } catch {
    return null;
  }
}

export type CouponCreateOptions = {
  clients: Array<{ id: string; nameEn: string; nameAr: string }>;
  mains: Array<{ id: string; nameEn: string; nameAr: string }>;
  subs: Array<{
    id: string;
    mainCategoryId: string;
    nameEn: string;
    nameAr: string;
  }>;
  serviceItems: Array<{
    id: string;
    subCategoryId: string;
    nameEn: string;
    nameAr: string;
  }>;
};

/** Thin options payload for the create-coupon form (gated on coupons:manage). */
export async function getCouponCreateOptions(): Promise<CouponCreateOptions | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "coupons:manage");

    const [clients, mains, subs, serviceItems] = await Promise.all([
      prisma.organisation.findMany({
        where: { type: "CLIENT", status: "ACTIVE" },
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: { nameEn: "asc" },
      }),
      prisma.mainCategory.findMany({
        where: { active: true },
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.subCategory.findMany({
        where: { active: true },
        select: { id: true, mainCategoryId: true, nameEn: true, nameAr: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.serviceItem.findMany({
        where: { active: true },
        select: { id: true, subCategoryId: true, nameEn: true, nameAr: true },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    return { clients, mains, subs, serviceItems };
  } catch {
    return null;
  }
}

// ─── getQualityView ──────────────────────────────────────────────────────────

export type QualityView = {
  reasons: Array<{ reason: ReturnReasonCode; count: number }>;
  auditLog: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string;
    actorEmail: string | null;
    actorNameEn: string | null;
    actorNameAr: string | null;
    createdAt: string;
  }>;
};

export async function getQualityView(): Promise<QualityView | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "quality:read");

    const day90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [reasonGroups, auditRows] = await Promise.all([
      prisma.$queryRaw<Array<{ reason: ReturnReasonCode; count: bigint }>>`
        SELECT unnest("reasonCodes") AS reason, COUNT(*) AS count
        FROM "RequestEvent"
        WHERE "toState" = 'RETURNED_TO_CLIENT' AND "createdAt" >= ${day90}
        GROUP BY reason
        ORDER BY count DESC
      `,
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          actor: { select: { email: true, fullNameEn: true, fullNameAr: true } },
        },
      }),
    ]);

    return {
      reasons: reasonGroups.map((r) => ({
        reason: r.reason,
        count: Number(r.count),
      })),
      auditLog: auditRows.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        actorEmail: a.actor?.email ?? null,
        actorNameEn: a.actor?.fullNameEn ?? null,
        actorNameAr: a.actor?.fullNameAr ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  } catch {
    return null;
  }
}

// ─── listAtlasStaff ──────────────────────────────────────────────────────────

export type AtlasStaffUser = {
  id: string;
  email: string;
  fullNameEn: string;
  fullNameAr: string;
  status: UserStatus;
  roles: Role[];
  lastLoginAt: string | null;
};

export async function listAtlasStaff(): Promise<AtlasStaffUser[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");

    const users = await prisma.user.findMany({
      where: { organisation: { type: "ATLAS" } },
      include: { roles: true },
      orderBy: { createdAt: "asc" },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullNameEn: u.fullNameEn,
      fullNameAr: u.fullNameAr,
      status: u.status,
      roles: u.roles.map((r) => r.role),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    }));
  } catch {
    return null;
  }
}

// ─── listAssignableStaff ─────────────────────────────────────────────────────

export type AssignableStaffUser = {
  id: string;
  fullNameEn: string;
  fullNameAr: string;
  email: string;
  roles: Role[];
};

/** Active Atlas staff a request can be assigned to. Any requests:admin user may list these. */
export async function listAssignableStaff(): Promise<AssignableStaffUser[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const users = await prisma.user.findMany({
      where: { organisation: { type: "ATLAS" }, status: "ACTIVE" },
      include: { roles: true },
      orderBy: { fullNameEn: "asc" },
    });

    return users.map((u) => ({
      id: u.id,
      fullNameEn: u.fullNameEn,
      fullNameAr: u.fullNameAr,
      email: u.email,
      roles: u.roles.map((r) => r.role),
    }));
  } catch {
    return null;
  }
}

// ─── getAtlasSettings ────────────────────────────────────────────────────────

export type AtlasSettings = {
  id: string;
  nameEn: string;
  nameAr: string;
  email: string;
  phone: string | null;
  website: string | null;
  logoKey: string | null;
  createdAt: string;
};

export async function getAtlasSettings(): Promise<AtlasSettings | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");

    const atlas = await prisma.organisation.findFirst({
      where: { type: "ATLAS" },
    });
    if (!atlas) return null;

    return {
      id: atlas.id,
      nameEn: atlas.nameEn,
      nameAr: atlas.nameAr,
      email: atlas.email,
      phone: atlas.phone,
      website: atlas.website,
      logoKey: atlas.logoKey,
      createdAt: atlas.createdAt.toISOString(),
    };
  } catch {
    return null;
  }
}

/** The single global Technical Review meta-checklist definition, flattened for editing. */
export async function getTechnicalReviewChecklistItems(): Promise<
  { code: string; titleEn: string; titleAr: string }[] | null
> {
  try {
    const session = await requireSession();
    requirePermission(session, "settings:admin");

    const definition = await prisma.technicalReviewChecklist.findUnique({
      where: { id: "singleton" },
    });
    const checkSets = parseCheckSets(definition?.checkSets);
    return checkSets.flatMap((s) =>
      s.items.map((i) => ({ code: i.code, titleEn: i.titleEn, titleAr: i.titleAr })),
    );
  } catch {
    return null;
  }
}
