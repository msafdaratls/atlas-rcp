import type {
  CommentDirection,
  CouponAppliesTo,
  CouponClientScope,
  CouponDiscountType,
  CouponStatus,
  FaultAttribution,
  OrganisationStatus,
  Role,
  RequestState,
  ReturnReasonCode,
  UserStatus,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
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
  DECISION: ["REPORT_ISSUED", "RETURNED_TO_CLIENT", "ON_HOLD", "CANCELLED"],
  REPORT_ISSUED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
  ON_HOLD: [],
};

/** Safe default when a hold has no recorded prior state (legacy rows). */
const ON_HOLD_RESUME_FALLBACK: RequestState = "UNDER_INTAKE_REVIEW";

/**
 * Resolves staff-visible transition targets for a request, including ON_HOLD
 * resume (heldFromState or UNDER_INTAKE_REVIEW) plus CANCELLED.
 */
export function allowedTransitionsFor(request: {
  state: RequestState;
  heldFromState: RequestState | null;
}): RequestState[] {
  if (request.state === "ON_HOLD") {
    const resume = request.heldFromState ?? ON_HOLD_RESUME_FALLBACK;
    return [resume, "CANCELLED"];
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
  requests: Array<{ id: string; requestNo: string; productName: string }>;
  clients: Array<{ id: string; name: string }>;
};

const EMPTY_SHELL_CHROME: AdminShellChrome = {
  queueDepth: 0,
  requests: [],
  clients: [],
};

export async function getAdminShellChrome(
  locale: "ar" | "en",
): Promise<AdminShellChrome> {
  try {
    const session = await requireSession();
    requirePermission(session, "admin:dashboard");

    const canRequests = checkPermission(session, "requests:admin");
    const canClients = checkPermission(session, "clients:read");

    const [queueDepth, requests, clients] = await Promise.all([
      canRequests
        ? prisma.request.count({
            where: { state: { in: QUEUE_DEPTH_STATES } },
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
              productNameEn: true,
              productNameAr: true,
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
      requests: requests.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        productName: locale === "ar" ? r.productNameAr : r.productNameEn,
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
        { productNameEn: { contains: q, mode: "insensitive" } },
        { productNameAr: { contains: q, mode: "insensitive" } },
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
          serviceItem: { select: { nameEn: true, nameAr: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
      rows: rows.map((r) => ({
        id: r.id,
        requestNo: r.requestNo,
        productNameEn: r.productNameEn,
        productNameAr: r.productNameAr,
        state: r.state,
        slaDueAt: r.slaDueAt?.toISOString() ?? null,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        organisationId: r.organisationId,
        orgNameEn: r.organisation.nameEn,
        orgNameAr: r.organisation.nameAr,
        serviceNameEn: r.serviceItem.nameEn,
        serviceNameAr: r.serviceItem.nameAr,
      })),
    };
  } catch {
    return null;
  }
}

// ─── getAdminRequestDetail ───────────────────────────────────────────────────

export type AdminRequestDetail = {
  id: string;
  requestNo: string;
  state: RequestState;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
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
  organisation: {
    id: string;
    nameEn: string;
    nameAr: string;
    email: string;
    phone: string | null;
  };
  serviceItem: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    slaHours: number;
    maxResubmissions: number;
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
    reasonCode: ReturnReasonCode | null;
    faultAttribution: FaultAttribution | null;
    createdAt: string;
  }>;
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
  comments: Array<{
    id: string;
    bodyEn: string | null;
    bodyAr: string | null;
    direction: CommentDirection;
    authorNameEn: string;
    authorNameAr: string;
    createdAt: string;
  }>;
};

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
        serviceItem: {
          select: {
            id: true,
            code: true,
            nameEn: true,
            nameAr: true,
            slaHours: true,
            maxResubmissions: true,
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
        documents: {
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
        comments: {
          include: {
            author: { select: { fullNameEn: true, fullNameAr: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!request) return null;

    return {
      id: request.id,
      requestNo: request.requestNo,
      state: request.state,
      productNameEn: request.productNameEn,
      productNameAr: request.productNameAr,
      brand: request.brand,
      productAttrs:
        request.productAttrs && typeof request.productAttrs === "object"
          ? (request.productAttrs as Record<string, unknown>)
          : {},
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
      }).filter((toState) =>
        canTransitionRequest(session, toState, {
          fromState: request.state,
          heldFromState: request.heldFromState,
        }),
      ),
      organisation: request.organisation,
      serviceItem: request.serviceItem,
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
        reasonCode: e.reasonCode,
        faultAttribution: e.faultAttribution,
        createdAt: e.createdAt.toISOString(),
      })),
      documents: request.documents.map((d) => ({
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
      comments: request.comments.map((c) => ({
        id: c.id,
        bodyEn: c.bodyEn,
        bodyAr: c.bodyAr,
        direction: c.direction,
        authorNameEn: c.author.fullNameEn,
        authorNameAr: c.author.fullNameAr,
        createdAt: c.createdAt.toISOString(),
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
          productNameEn: true,
          productNameAr: true,
          state: true,
          updatedAt: true,
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
        productNameEn: r.productNameEn,
        productNameAr: r.productNameAr,
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
  active: boolean;
  basePrice: number;
  slaHours: number;
  subCategoryId: string;
  subCategoryNameEn: string;
  subCategoryNameAr: string;
  mainCategoryId: string;
  mainCategoryNameEn: string;
  mainCategoryNameAr: string;
};

export async function listAdminCatalogue(): Promise<AdminCatalogueItem[] | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "catalogue:manage");

    const items = await prisma.serviceItem.findMany({
      include: { subCategory: { include: { mainCategory: true } } },
      orderBy: [{ subCategoryId: "asc" }, { sortOrder: "asc" }],
    });

    return items.map((item) => ({
      id: item.id,
      code: item.code,
      nameEn: item.nameEn,
      nameAr: item.nameAr,
      active: item.active,
      basePrice: toNumber(item.basePrice),
      slaHours: item.slaHours,
      subCategoryId: item.subCategoryId,
      subCategoryNameEn: item.subCategory.nameEn,
      subCategoryNameAr: item.subCategory.nameAr,
      mainCategoryId: item.subCategory.mainCategoryId,
      mainCategoryNameEn: item.subCategory.mainCategory.nameEn,
      mainCategoryNameAr: item.subCategory.mainCategory.nameAr,
    }));
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
  subCategories: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
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
      subCategories: main.subCategories.map((sub) => ({
        id: sub.id,
        code: sub.code,
        nameEn: sub.nameEn,
        nameAr: sub.nameAr,
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
      prisma.requestEvent.groupBy({
        by: ["reasonCode"],
        where: {
          toState: "RETURNED_TO_CLIENT",
          reasonCode: { not: null },
          createdAt: { gte: day90 },
        },
        _count: { _all: true },
        orderBy: { _count: { reasonCode: "desc" } },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
        include: {
          actor: { select: { email: true, fullNameEn: true, fullNameAr: true } },
        },
      }),
    ]);

    return {
      reasons: reasonGroups
        .filter((r) => r.reasonCode)
        .map((r) => ({
          reason: r.reasonCode as ReturnReasonCode,
          count: r._count._all,
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
