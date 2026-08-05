import { prisma } from "@/lib/db";
import { consumeRateLimitAsync } from "@/lib/rate-limit";

/**
 * Fields safe to show to an unauthenticated visitor scanning a report QR
 * code. Never include pricing, documents, comments, or internal notes here.
 */
export type PublicVerification = {
  requestNo: string;
  state: "REPORT_ISSUED" | "CLOSED";
  organisationNameEn: string;
  organisationNameAr: string;
  items: Array<{
    productNameEn: string;
    productNameAr: string;
    serviceNameEn: string;
    serviceNameAr: string;
  }>;
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

  const limited = await consumeRateLimitAsync({
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
      items: {
        orderBy: { sortOrder: "asc" },
        include: { serviceItem: { select: { nameEn: true, nameAr: true } } },
      },
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
    organisationNameEn: row.organisation.nameEn,
    organisationNameAr: row.organisation.nameAr,
    items: row.items.map((item) => ({
      productNameEn: item.productNameEn,
      productNameAr: item.productNameAr,
      serviceNameEn: item.serviceItem.nameEn,
      serviceNameAr: item.serviceItem.nameAr,
    })),
    issuedAt,
  };
}
