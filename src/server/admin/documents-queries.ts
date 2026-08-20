import type { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";

export type DocumentTypeFilter = "ALL" | "PDF" | "IMAGE" | "OTHER";

export type DocumentRow = {
  id: string;
  label: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  version: number;
  uploadedByNameEn: string;
  uploadedByNameAr: string;
  uploadedAt: string;
  requestId: string;
  requestNo: string;
  organisationNameEn: string;
  organisationNameAr: string;
  productNameEn: string;
  productNameAr: string;
};

export type DocumentsView = {
  rows: DocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

const PAGE_SIZE = 50;

/**
 * All client-uploaded documents across every request (labels, certificates,
 * COAs, evaluation-activity reports, external-deliverable certificates) in
 * one browsable list. Gated same as per-request document access
 * (requests:admin), since it exposes nothing a staff member couldn't already
 * see by opening each request individually.
 */
export async function getDocumentsView(input: {
  q?: string | null;
  type?: DocumentTypeFilter | null;
  page?: number;
}): Promise<DocumentsView> {
  const session = await requireSession();
  requirePermission(session, "requests:admin");

  const page = Math.max(1, input.page ?? 1);
  const q = input.q?.trim();
  const type = input.type ?? "ALL";

  const and: Prisma.RequestDocumentWhereInput[] = [{ currentVersionId: { not: null } }];

  if (q) {
    and.push({
      OR: [
        { label: { contains: q, mode: "insensitive" } },
        { currentVersion: { fileName: { contains: q, mode: "insensitive" } } },
        { request: { requestNo: { contains: q, mode: "insensitive" } } },
        { request: { organisation: { nameEn: { contains: q, mode: "insensitive" } } } },
        { request: { organisation: { nameAr: { contains: q, mode: "insensitive" } } } },
        { requestItem: { productNameEn: { contains: q, mode: "insensitive" } } },
        { requestItem: { productNameAr: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  if (type === "PDF") {
    and.push({ currentVersion: { mimeType: "application/pdf" } });
  } else if (type === "IMAGE") {
    and.push({ currentVersion: { mimeType: { startsWith: "image/" } } });
  } else if (type === "OTHER") {
    and.push({
      NOT: [
        { currentVersion: { mimeType: "application/pdf" } },
        { currentVersion: { mimeType: { startsWith: "image/" } } },
      ],
    });
  }

  const where: Prisma.RequestDocumentWhereInput = { AND: and };

  const [total, docs] = await Promise.all([
    prisma.requestDocument.count({ where }),
    prisma.requestDocument.findMany({
      where,
      orderBy: { currentVersion: { uploadedAt: "desc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        label: true,
        currentVersion: {
          select: {
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            storageKey: true,
            version: true,
            uploadedAt: true,
            uploadedBy: { select: { fullNameEn: true, fullNameAr: true } },
          },
        },
        request: {
          select: {
            id: true,
            requestNo: true,
            organisation: { select: { nameEn: true, nameAr: true } },
          },
        },
        requestItem: { select: { productNameEn: true, productNameAr: true } },
      },
    }),
  ]);

  return {
    rows: docs
      .filter((d) => d.currentVersion !== null)
      .map((d) => {
        const v = d.currentVersion!;
        return {
          id: d.id,
          label: d.label,
          fileName: v.fileName,
          mimeType: v.mimeType,
          sizeBytes: v.sizeBytes,
          storageKey: v.storageKey,
          version: v.version,
          uploadedByNameEn: v.uploadedBy.fullNameEn,
          uploadedByNameAr: v.uploadedBy.fullNameAr,
          uploadedAt: v.uploadedAt.toISOString(),
          requestId: d.request.id,
          requestNo: d.request.requestNo,
          organisationNameEn: d.request.organisation.nameEn,
          organisationNameAr: d.request.organisation.nameAr,
          productNameEn: d.requestItem.productNameEn,
          productNameAr: d.requestItem.productNameAr,
        };
      }),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
