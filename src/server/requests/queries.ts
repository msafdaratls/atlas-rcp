import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { resolveRequestContext } from "@/lib/request-context";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { toNumber } from "@/lib/pricing";
import { scopedDb } from "@/lib/scoped-db";
import { invoiceOpenBalance } from "@/server/finance/queries";
import { exceedsMaxResubmissions } from "@/lib/billing-helpers";

export type CatalogueMain = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string | null;
  descAr: string | null;
  icon: string | null;
};

export type CatalogueSub = {
  id: string;
  mainCategoryId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string | null;
  descAr: string | null;
};

export type CatalogueServiceItem = {
  id: string;
  subCategoryId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  descEn: string | null;
  descAr: string | null;
  basePrice: number;
  vatRate: number;
  slaHours: number;
  requiredDocumentCount: number;
  productAttrSchema: unknown;
  checkSets: Array<{ code: string; titleEn: string; titleAr: string }>;
  requiredDocuments: Array<{
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    mandatory: boolean;
    acceptedMimeTypes: string[];
    maxSizeMb: number;
    helpEn: string | null;
    helpAr: string | null;
  }>;
};

export type CataloguePayload = {
  mains: CatalogueMain[];
  subs: CatalogueSub[];
  items: CatalogueServiceItem[];
};

function parseCheckSets(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      if (
        typeof r.code !== "string" ||
        typeof r.titleEn !== "string" ||
        typeof r.titleAr !== "string"
      ) {
        return null;
      }
      return {
        code: r.code,
        titleEn: r.titleEn,
        titleAr: r.titleAr,
      };
    })
    .filter((x): x is { code: string; titleEn: string; titleAr: string } =>
      Boolean(x),
    );
}

export async function getCatalogueForNewRequest(): Promise<CataloguePayload | null> {
  try {
    await resolveRequestContext();

    const [mains, subs, items] = await Promise.all([
      prisma.mainCategory.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.subCategory.findMany({
        where: { active: true },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.serviceItem.findMany({
        where: { active: true },
        include: { requiredDocuments: { orderBy: { sortOrder: "asc" } } },
        orderBy: { sortOrder: "asc" },
      }),
    ]);

    return {
      mains: mains.map((m) => ({
        id: m.id,
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        descEn: m.descEn,
        descAr: m.descAr,
        icon: m.icon,
      })),
      subs: subs.map((s) => ({
        id: s.id,
        mainCategoryId: s.mainCategoryId,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        descEn: s.descEn,
        descAr: s.descAr,
      })),
      items: items.map((item) => ({
        id: item.id,
        subCategoryId: item.subCategoryId,
        code: item.code,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        descEn: item.descEn,
        descAr: item.descAr,
        basePrice: toNumber(item.basePrice),
        vatRate: toNumber(item.vatRate),
        slaHours: item.slaHours,
        requiredDocumentCount: item.requiredDocuments.length,
        productAttrSchema: item.productAttrSchema,
        checkSets: parseCheckSets(item.checkSets),
        requiredDocuments: item.requiredDocuments.map((d) => ({
          id: d.id,
          code: d.code,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
          mandatory: d.mandatory,
          acceptedMimeTypes: d.acceptedMimeTypes,
          maxSizeMb: d.maxSizeMb,
          helpEn: d.helpEn,
          helpAr: d.helpAr,
        })),
      })),
    };
  } catch {
    return null;
  }
}

export async function getOpenDraftRequestId(): Promise<string | null> {
  try {
    const ctx = await resolveRequestContext();
    const draft = await prisma.request.findFirst({
      where: {
        organisationId: ctx.organisationId,
        createdByUserId: ctx.actorUserId,
        state: "DRAFT",
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    return draft?.id ?? null;
  } catch {
    return null;
  }
}

export type DraftRequestView = {
  id: string;
  requestNo: string;
  serviceItemId: string;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
  couponCode: string | null;
  discountApplied: number;
  priceCharged: number;
  documents: Array<{
    id: string;
    requiredDocumentId: string | null;
    label: string;
    currentVersion: {
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
      version: number;
    } | null;
  }>;
};

export async function getDraftRequest(
  requestId: string,
): Promise<DraftRequestView | null> {
  try {
    const ctx = await resolveRequestContext();
    const draft = await prisma.request.findFirst({
      where: {
        id: requestId,
        organisationId: ctx.organisationId,
        state: "DRAFT",
      },
      include: {
        documents: {
          include: { currentVersion: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!draft) return null;

    return {
      id: draft.id,
      requestNo: draft.requestNo,
      serviceItemId: draft.serviceItemId,
      productNameEn: draft.productNameEn,
      productNameAr: draft.productNameAr,
      brand: draft.brand,
      productAttrs:
        draft.productAttrs && typeof draft.productAttrs === "object"
          ? (draft.productAttrs as Record<string, unknown>)
          : {},
      couponCode: draft.couponCode,
      discountApplied: toNumber(draft.discountApplied),
      priceCharged: toNumber(draft.priceCharged),
      documents: draft.documents.map((d) => ({
        id: d.id,
        requiredDocumentId: d.requiredDocumentId,
        label: d.label,
        currentVersion: d.currentVersion
          ? {
              id: d.currentVersion.id,
              fileName: d.currentVersion.fileName,
              mimeType: d.currentVersion.mimeType,
              sizeBytes: d.currentVersion.sizeBytes,
              storageKey: d.currentVersion.storageKey,
              version: d.currentVersion.version,
            }
          : null,
      })),
    };
  } catch {
    return null;
  }
}

export function decimal(n: number | string): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

export type ClientRequestListItem = {
  id: string;
  requestNo: string;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  state: import("@prisma/client").RequestState;
  submissionNo: number;
  submittedAt: string | null;
  slaDueAt: string | null;
  updatedAt: string;
  serviceNameEn: string;
  serviceNameAr: string;
};

export type ClientRequestListResult = {
  rows: ClientRequestListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listClientRequests(input: {
  q?: string | null;
  state?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<ClientRequestListResult | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:read");
    const { organisationId } = scopedDb(session);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, input.pageSize ?? 10));
    const q = input.q?.trim() || "";
    const state =
      input.state && input.state !== "ALL"
        ? (input.state as import("@prisma/client").RequestState)
        : null;

    const where: Prisma.RequestWhereInput = {
      organisationId,
      ...(state ? { state } : {}),
      ...(q
        ? {
            OR: [
              { requestNo: { contains: q, mode: "insensitive" } },
              { productNameEn: { contains: q, mode: "insensitive" } },
              { productNameAr: { contains: q, mode: "insensitive" } },
              { brand: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.request.count({ where }),
      prisma.request.findMany({
        where,
        include: {
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
        brand: r.brand,
        state: r.state,
        submissionNo: r.submissionNo,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        slaDueAt: r.slaDueAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
        serviceNameEn: r.serviceItem.nameEn,
        serviceNameAr: r.serviceItem.nameAr,
      })),
    };
  } catch {
    return null;
  }
}

/** States excluded from the client shell command-palette shortlist. */
const CLIENT_SHELL_CLOSED_STATES: import("@prisma/client").RequestState[] = [
  "DRAFT",
  "CLOSED",
  "CANCELLED",
];

export type ClientShellRequest = {
  id: string;
  requestNo: string;
  productName: string;
};

/**
 * Last ~10 open requests for the session's own organisation, used to seed the
 * client shell command palette. Requires `requests:read` — finance-only roles
 * get an empty list so request titles never leak.
 */
export async function getClientShellRequests(
  locale: "ar" | "en",
): Promise<ClientShellRequest[]> {
  try {
    const session = await requireSession();
    if (session.organisation.type !== "CLIENT") return [];
    try {
      requirePermission(session, "requests:read");
    } catch {
      return [];
    }

    const { organisationId } = scopedDb(session);
    const requests = await prisma.request.findMany({
      where: {
        organisationId,
        state: { notIn: CLIENT_SHELL_CLOSED_STATES },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, requestNo: true, productNameEn: true, productNameAr: true },
    });

    return requests.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      productName: locale === "ar" ? r.productNameAr : r.productNameEn,
    }));
  } catch {
    return [];
  }
}

export type ClientRequestDetail = {
  id: string;
  requestNo: string;
  state: import("@prisma/client").RequestState;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
  productAttrSchema: unknown;
  submissionNo: number;
  submittedAt: string | null;
  slaDueAt: string | null;
  closedAt: string | null;
  priceCharged: number;
  serviceNameEn: string;
  serviceNameAr: string;
  maxResubmissions: number;
  canResubmit: boolean;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: import("@prisma/client").InvoiceStatus;
    total: number;
    openAmount: number;
  }>;
  returnInfo: {
    reasonCode: import("@prisma/client").ReturnReasonCode | null;
    faultAttribution: import("@prisma/client").FaultAttribution | null;
    note: string | null;
    createdAt: string;
  } | null;
  events: Array<{
    id: string;
    fromState: import("@prisma/client").RequestState | null;
    toState: import("@prisma/client").RequestState;
    actorNameEn: string;
    actorNameAr: string;
    actorRole: import("@prisma/client").Role;
    note: string | null;
    reasonCode: import("@prisma/client").ReturnReasonCode | null;
    faultAttribution: import("@prisma/client").FaultAttribution | null;
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
    direction: import("@prisma/client").CommentDirection;
    authorNameEn: string;
    authorNameAr: string;
    createdAt: string;
  }>;
  requiredDocuments: Array<{
    id: string;
    nameEn: string;
    nameAr: string;
    mandatory: boolean;
    acceptedMimeTypes: string[];
    maxSizeMb: number;
  }>;
};

export async function getClientRequestDetail(
  requestId: string,
): Promise<ClientRequestDetail | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:read");
    const { organisationId } = scopedDb(session);
    const request = await prisma.request.findFirst({
      where: { id: requestId, organisationId },
      include: {
        serviceItem: {
          include: { requiredDocuments: { orderBy: { sortOrder: "asc" } } },
        },
        events: {
          include: { actor: { select: { fullNameEn: true, fullNameAr: true } } },
          orderBy: { createdAt: "asc" },
        },
        documents: {
          include: {
            versions: {
              include: {
                uploadedBy: {
                  select: { fullNameEn: true, fullNameAr: true },
                },
              },
              orderBy: { version: "asc" },
            },
            currentVersion: {
              include: {
                uploadedBy: {
                  select: { fullNameEn: true, fullNameAr: true },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        comments: {
          where: { direction: { not: "INTERNAL" } },
          include: {
            author: { select: { fullNameEn: true, fullNameAr: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        invoices: {
          where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
          include: { allocations: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!request) return null;

    const lastReturn = [...request.events]
      .reverse()
      .find((e) => e.toState === "RETURNED_TO_CLIENT");

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
      productAttrSchema: request.serviceItem.productAttrSchema,
      submissionNo: request.submissionNo,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      slaDueAt: request.slaDueAt?.toISOString() ?? null,
      closedAt: request.closedAt?.toISOString() ?? null,
      priceCharged: toNumber(request.priceCharged),
      serviceNameEn: request.serviceItem.nameEn,
      serviceNameAr: request.serviceItem.nameAr,
      maxResubmissions: request.serviceItem.maxResubmissions,
      canResubmit:
        request.state === "RETURNED_TO_CLIENT" &&
        !exceedsMaxResubmissions(
          request.submissionNo,
          request.serviceItem.maxResubmissions,
        ),
      invoices: request.invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        status: inv.status,
        total: toNumber(inv.total),
        openAmount: toNumber(invoiceOpenBalance(inv.total, inv.allocations)),
      })),
      returnInfo: lastReturn
        ? {
            reasonCode: lastReturn.reasonCode,
            faultAttribution: lastReturn.faultAttribution,
            note: lastReturn.note,
            createdAt: lastReturn.createdAt.toISOString(),
          }
        : null,
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
      requiredDocuments: request.serviceItem.requiredDocuments.map((d) => ({
        id: d.id,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        mandatory: d.mandatory,
        acceptedMimeTypes: d.acceptedMimeTypes,
        maxSizeMb: d.maxSizeMb,
      })),
    };
  } catch {
    return null;
  }
}

export type ClientReportListItem = {
  id: string;
  requestNo: string;
  productNameEn: string;
  productNameAr: string;
  state: "REPORT_ISSUED" | "CLOSED";
  issuedAt: string;
  serviceNameEn: string;
  serviceNameAr: string;
};

export type ClientReportListResult = {
  rows: ClientReportListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listClientReports(input: {
  q?: string | null;
  year?: number | null;
  page?: number;
  pageSize?: number;
}): Promise<ClientReportListResult | null> {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:read");
    const { organisationId } = scopedDb(session);
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, input.pageSize ?? 10));
    const q = input.q?.trim() || "";
    const year = input.year ?? new Date().getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);

    const where: Prisma.RequestWhereInput = {
      organisationId,
      state: { in: ["REPORT_ISSUED", "CLOSED"] },
      OR: [
        { closedAt: { gte: yearStart, lt: yearEnd } },
        {
          closedAt: null,
          state: "REPORT_ISSUED",
          OR: [
            {
              events: {
                some: {
                  toState: "REPORT_ISSUED",
                  createdAt: { gte: yearStart, lt: yearEnd },
                },
              },
            },
            { updatedAt: { gte: yearStart, lt: yearEnd } },
          ],
        },
      ],
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { requestNo: { contains: q, mode: "insensitive" } },
                  { productNameEn: { contains: q, mode: "insensitive" } },
                  { productNameAr: { contains: q, mode: "insensitive" } },
                ],
              },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.request.count({ where }),
      prisma.request.findMany({
        where,
        include: {
          serviceItem: { select: { nameEn: true, nameAr: true } },
          events: {
            where: { toState: "REPORT_ISSUED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
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
      rows: rows.map((r) => {
        const issued =
          r.events[0]?.createdAt ??
          r.closedAt ??
          r.updatedAt;
        return {
          id: r.id,
          requestNo: r.requestNo,
          productNameEn: r.productNameEn,
          productNameAr: r.productNameAr,
          state: r.state as "REPORT_ISSUED" | "CLOSED",
          issuedAt: issued.toISOString(),
          serviceNameEn: r.serviceItem.nameEn,
          serviceNameAr: r.serviceItem.nameAr,
        };
      }),
    };
  } catch {
    return null;
  }
}

export async function getAtlasSupportContacts(): Promise<{
  nameEn: string;
  nameAr: string;
  email: string;
  phone: string | null;
} | null> {
  try {
    await requireSession();
    const atlas = await prisma.organisation.findFirst({
      where: { type: "ATLAS" },
      select: { nameEn: true, nameAr: true, email: true, phone: true },
    });
    return atlas;
  } catch {
    return null;
  }
}
