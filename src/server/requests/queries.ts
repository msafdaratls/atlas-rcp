import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { resolveRequestContext } from "@/lib/request-context";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { toNumber } from "@/lib/pricing";
import { scopedDb } from "@/lib/scoped-db";
import { storage } from "@/lib/storage";
import { invoiceOpenBalance } from "@/server/finance/queries";
import { exceedsMaxResubmissions } from "@/lib/billing-helpers";

/** Null when no template has been uploaded for this document slot yet. */
function templateUrlFor(storageKey: string | null): string | null {
  return storageKey ? storage.publicUrl(storageKey) : null;
}

/**
 * Shared by every query that hands required documents to a client surface —
 * without the nested `templates` a variant slot (SAB-001's risk assessment)
 * would silently render no download link at all.
 */
export const requiredDocumentsInclude = {
  requiredDocuments: {
    orderBy: { sortOrder: "asc" },
    include: { templates: { orderBy: { sortOrder: "asc" } } },
  },
} as const;

type RequiredDocumentRow = {
  templateStorageKey: string | null;
  templateFileName: string | null;
  templateVariantAttrKey: string | null;
  templates: { variantKey: string; storageKey: string; fileName: string }[];
};

/** The template half of a required-document payload, single or per-variant. */
function templateFieldsFor(d: RequiredDocumentRow) {
  return {
    templateUrl: templateUrlFor(d.templateStorageKey),
    templateFileName: d.templateFileName,
    templateVariantAttrKey: d.templateVariantAttrKey,
    templateVariants: d.templates.map((t) => ({
      variantKey: t.variantKey,
      url: storage.publicUrl(t.storageKey),
      fileName: t.fileName,
    })),
  };
}

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
  deliverableEn: string | null;
  deliverableAr: string | null;
  deliverableType: "INTERNAL_REPORT" | "EXTERNAL_CERTIFICATE";
  requiredCredentialPlatform: "GHAD" | "SABER" | "FASAH" | null;
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
    templateUrl: string | null;
    templateFileName: string | null;
    templateVariantAttrKey: string | null;
    templateVariants: TemplateVariantView[];
  }>;
};

/** One blank form for a specific value of the slot's variant attribute. */
export type TemplateVariantView = {
  variantKey: string;
  url: string;
  fileName: string;
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

// The active catalogue tree changes only when an admin edits it (rare) but is
// read on every visit to the new-request wizard (constant) — cache it the
// same way buildCatalogueContext already does for the assistant chat
// (module-level, short TTL, no invalidation hook: 5 minutes of staleness
// after a catalogue edit is the accepted trade-off already established
// there, not a new one introduced here).
const CATALOGUE_CACHE_TTL_MS = 5 * 60 * 1000;
let cataloguePayloadCache: { payload: CataloguePayload; expiresAt: number } | null = null;

async function loadCataloguePayload(): Promise<CataloguePayload> {
  if (cataloguePayloadCache && cataloguePayloadCache.expiresAt > Date.now()) {
    return cataloguePayloadCache.payload;
  }

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
      include: requiredDocumentsInclude,
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  const payload: CataloguePayload = {
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
      deliverableEn: item.deliverableEn,
      deliverableAr: item.deliverableAr,
      deliverableType: item.deliverableType,
      requiredCredentialPlatform: item.requiredCredentialPlatform,
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
        ...templateFieldsFor(d),
      })),
    })),
  };

  cataloguePayloadCache = { payload, expiresAt: Date.now() + CATALOGUE_CACHE_TTL_MS };
  return payload;
}

export async function getCatalogueForNewRequest(): Promise<CataloguePayload | null> {
  try {
    await resolveRequestContext();
    return await loadCataloguePayload();
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

export type DraftRequestDocumentView = {
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
};

export type DraftRequestItemView = {
  id: string;
  serviceItemId: string;
  serviceNameEn: string;
  serviceNameAr: string;
  basePrice: number;
  vatRate: number;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
  productAttrSchema: unknown;
  platformCredentialId: string | null;
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
    templateUrl: string | null;
    templateFileName: string | null;
    templateVariantAttrKey: string | null;
    templateVariants: TemplateVariantView[];
  }>;
  documents: DraftRequestDocumentView[];
};

export type DraftRequestView = {
  id: string;
  requestNo: string;
  couponCode: string | null;
  discountApplied: number;
  priceCharged: number;
  items: DraftRequestItemView[];
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
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            serviceItem: {
              include: requiredDocumentsInclude,
            },
            documents: {
              include: { currentVersion: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
    if (!draft) return null;

    return {
      id: draft.id,
      requestNo: draft.requestNo,
      couponCode: draft.couponCode,
      discountApplied: toNumber(draft.discountApplied),
      priceCharged: toNumber(draft.priceCharged),
      items: draft.items.map((item) => ({
        id: item.id,
        serviceItemId: item.serviceItemId,
        serviceNameEn: item.serviceItem.nameEn,
        serviceNameAr: item.serviceItem.nameAr,
        basePrice: toNumber(item.basePrice),
        vatRate: toNumber(item.vatRate),
        productNameEn: item.productNameEn,
        productNameAr: item.productNameAr,
        brand: item.brand,
        productAttrs:
          item.productAttrs && typeof item.productAttrs === "object"
            ? (item.productAttrs as Record<string, unknown>)
            : {},
        productAttrSchema: item.serviceItem.productAttrSchema,
        platformCredentialId: item.platformCredentialId,
        requiredDocuments: item.serviceItem.requiredDocuments.map((d) => ({
          id: d.id,
          code: d.code,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
          mandatory: d.mandatory,
          acceptedMimeTypes: d.acceptedMimeTypes,
          maxSizeMb: d.maxSizeMb,
          helpEn: d.helpEn,
          helpAr: d.helpAr,
          ...templateFieldsFor(d),
        })),
        documents: item.documents.map((d) => ({
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
  /** Count of additional items beyond the first, for a "+N more" badge. */
  extraItemCount: number;
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
              {
                items: {
                  some: {
                    OR: [
                      { productNameEn: { contains: q, mode: "insensitive" } },
                      { productNameAr: { contains: q, mode: "insensitive" } },
                      { brand: { contains: q, mode: "insensitive" } },
                    ],
                  },
                },
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
          brand: first?.brand ?? null,
          state: r.state,
          submissionNo: r.submissionNo,
          submittedAt: r.submittedAt?.toISOString() ?? null,
          slaDueAt: r.slaDueAt?.toISOString() ?? null,
          updatedAt: r.updatedAt.toISOString(),
          serviceNameEn: first?.serviceItem.nameEn ?? "",
          serviceNameAr: first?.serviceItem.nameAr ?? "",
          extraItemCount: Math.max(0, r.items.length - 1),
        };
      }),
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
      select: {
        id: true,
        requestNo: true,
        items: {
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: { productNameEn: true, productNameAr: true },
        },
      },
    });

    return requests.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      productName:
        (locale === "ar" ? r.items[0]?.productNameAr : r.items[0]?.productNameEn) ??
        "",
    }));
  } catch {
    return [];
  }
}

export type ClientRequestDetailItem = {
  id: string;
  serviceItemId: string;
  serviceItemCode: string;
  serviceNameEn: string;
  serviceNameAr: string;
  productNameEn: string;
  productNameAr: string;
  brand: string | null;
  productAttrs: Record<string, unknown>;
  productAttrSchema: unknown;
  maxResubmissions: number;
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
  requiredDocuments: Array<{
    id: string;
    nameEn: string;
    nameAr: string;
    mandatory: boolean;
    acceptedMimeTypes: string[];
    maxSizeMb: number;
    helpEn: string | null;
    helpAr: string | null;
    templateUrl: string | null;
    templateFileName: string | null;
    templateVariantAttrKey: string | null;
    templateVariants: TemplateVariantView[];
  }>;
};

export type ClientRequestDetail = {
  id: string;
  requestNo: string;
  state: import("@prisma/client").RequestState;
  submissionNo: number;
  submittedAt: string | null;
  createdAt: string;
  slaDueAt: string | null;
  closedAt: string | null;
  priceCharged: number;
  items: ClientRequestDetailItem[];
  canResubmit: boolean;
  canRequestReopen: boolean;
  reopenRequest: {
    id: string;
    status: import("@prisma/client").ReopenRequestStatus;
    reason: string;
    decisionNote: string | null;
    targetState: import("@prisma/client").RequestState | null;
    createdAt: string;
    decidedAt: string | null;
  } | null;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: import("@prisma/client").InvoiceStatus;
    total: number;
    openAmount: number;
  }>;
  returnInfo: {
    reasonCodes: import("@prisma/client").ReturnReasonCode[];
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
    reasonCodes: import("@prisma/client").ReturnReasonCode[];
    faultAttribution: import("@prisma/client").FaultAttribution | null;
    createdAt: string;
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
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            serviceItem: {
              include: requiredDocumentsInclude,
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
          },
        },
        events: {
          include: { actor: { select: { fullNameEn: true, fullNameAr: true } } },
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
        reopenRequests: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!request) return null;

    const { REOPENABLE_STATES } = await import("@/server/admin/queries");
    const latestReopenRequest = request.reopenRequests[0] ?? null;

    const lastReturn = [...request.events]
      .reverse()
      .find((e) => e.toState === "RETURNED_TO_CLIENT");

    const minMaxResubmissions = Math.min(
      ...request.items.map((i) => i.serviceItem.maxResubmissions),
    );

    return {
      id: request.id,
      requestNo: request.requestNo,
      state: request.state,
      submissionNo: request.submissionNo,
      submittedAt: request.submittedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      slaDueAt: request.slaDueAt?.toISOString() ?? null,
      closedAt: request.closedAt?.toISOString() ?? null,
      priceCharged: toNumber(request.priceCharged),
      items: request.items.map((item) => ({
        id: item.id,
        serviceItemId: item.serviceItemId,
        serviceItemCode: item.serviceItem.code,
        serviceNameEn: item.serviceItem.nameEn,
        serviceNameAr: item.serviceItem.nameAr,
        productNameEn: item.productNameEn,
        productNameAr: item.productNameAr,
        brand: item.brand,
        productAttrs:
          item.productAttrs && typeof item.productAttrs === "object"
            ? (item.productAttrs as Record<string, unknown>)
            : {},
        productAttrSchema: item.serviceItem.productAttrSchema,
        maxResubmissions: item.serviceItem.maxResubmissions,
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
        requiredDocuments: item.serviceItem.requiredDocuments.map((d) => ({
          id: d.id,
          nameEn: d.nameEn,
          nameAr: d.nameAr,
          mandatory: d.mandatory,
          acceptedMimeTypes: d.acceptedMimeTypes,
          maxSizeMb: d.maxSizeMb,
          helpEn: d.helpEn,
          helpAr: d.helpAr,
          ...templateFieldsFor(d),
        })),
      })),
      canResubmit:
        request.state === "RETURNED_TO_CLIENT" &&
        !exceedsMaxResubmissions(request.submissionNo, minMaxResubmissions),
      canRequestReopen:
        REOPENABLE_STATES.includes(request.state) &&
        latestReopenRequest?.status !== "PENDING",
      reopenRequest: latestReopenRequest
        ? {
            id: latestReopenRequest.id,
            status: latestReopenRequest.status,
            reason: latestReopenRequest.reason,
            decisionNote: latestReopenRequest.decisionNote,
            targetState: latestReopenRequest.targetState,
            createdAt: latestReopenRequest.createdAt.toISOString(),
            decidedAt: latestReopenRequest.decidedAt?.toISOString() ?? null,
          }
        : null,
      invoices: request.invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        status: inv.status,
        total: toNumber(inv.total),
        openAmount: toNumber(invoiceOpenBalance(inv.total, inv.allocations)),
      })),
      returnInfo: lastReturn
        ? {
            reasonCodes: lastReturn.reasonCodes,
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
          items: {
            orderBy: { sortOrder: "asc" },
            take: 1,
            include: { serviceItem: { select: { nameEn: true, nameAr: true } } },
          },
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
        const first = r.items[0];
        return {
          id: r.id,
          requestNo: r.requestNo,
          productNameEn: first?.productNameEn ?? "",
          productNameAr: first?.productNameAr ?? "",
          state: r.state as "REPORT_ISSUED" | "CLOSED",
          issuedAt: issued.toISOString(),
          serviceNameEn: first?.serviceItem.nameEn ?? "",
          serviceNameAr: first?.serviceItem.nameAr ?? "",
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
