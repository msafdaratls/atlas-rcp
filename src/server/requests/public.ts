import { prisma } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";

/**
 * Fields safe to show to an unauthenticated visitor scanning a report QR
 * code. Never include pricing, documents, comments, or internal notes here.
 */
export type PublicVerification = {
  requestNo: string;
  state: "REPORT_ISSUED" | "CLOSED";
  productNameEn: string;
  productNameAr: string;
  organisationNameEn: string;
  organisationNameAr: string;
  serviceNameEn: string;
  serviceNameAr: string;
  issuedAt: string;
};

/**
 * Public, unauthenticated lookup by request number. Only requests that have
 * reached REPORT_ISSUED or CLOSED are verifiable — anything earlier in the
 * workflow returns null just like an unknown code.
 */
export async function getPublicVerification(
  code: string,
): Promise<PublicVerification | null> {
  const requestNo = code.trim();
  if (!requestNo) return null;

  const limited = consumeRateLimit({
    key: `verify:${requestNo.toLowerCase()}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return null;
  }

  const row = await prisma.request.findFirst({
    where: {
      requestNo: { equals: requestNo, mode: "insensitive" },
      state: { in: ["REPORT_ISSUED", "CLOSED"] },
    },
    include: {
      organisation: { select: { nameEn: true, nameAr: true } },
      serviceItem: { select: { nameEn: true, nameAr: true } },
      events: {
        where: { toState: "REPORT_ISSUED" },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!row) return null;

  const issuedAt = (
    row.events[0]?.createdAt ??
    row.closedAt ??
    row.updatedAt
  ).toISOString();

  return {
    requestNo: row.requestNo,
    state: row.state as "REPORT_ISSUED" | "CLOSED",
    productNameEn: row.productNameEn,
    productNameAr: row.productNameAr,
    organisationNameEn: row.organisation.nameEn,
    organisationNameAr: row.organisation.nameAr,
    serviceNameEn: row.serviceItem.nameEn,
    serviceNameAr: row.serviceItem.nameAr,
    issuedAt,
  };
}
