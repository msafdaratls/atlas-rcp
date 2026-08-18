import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission, scopedOrganisationId } from "@/lib/rbac";
import { renderScocCertificatePdf } from "@/server/finance/pdf-templates";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestItemId: string }> };

const requestItemIdSchema = z.string().cuid();

/** SAB-002 — the only service this certificate layout applies to. */
const SCOC_SERVICE_CODE = "SAB-002";

/** SABER shipment certificates are valid ~60 days from issuance. */
const SCOC_CERT_VALIDITY_DAYS = 60;

function mapError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "UNAUTHORIZED";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (message === "NOT_FOUND") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const isAtlas = session.organisation.type === "ATLAS";
    if (isAtlas) {
      requirePermission(session, "requests:admin");
    } else {
      requirePermission(session, "requests:read");
    }
    const { requestItemId: rawId } = await params;
    const idParsed = requestItemIdSchema.safeParse(rawId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    const requestItemId = idParsed.data;
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "en" ? "en" : "ar";

    const item = await prisma.requestItem.findFirst({
      where: {
        id: requestItemId,
        serviceItem: { code: SCOC_SERVICE_CODE },
        request: {
          state: { in: ["REPORT_ISSUED", "CLOSED"] },
          ...(isAtlas ? {} : { organisationId: scopedOrganisationId(session) }),
        },
      },
      include: {
        request: { include: { organisation: true } },
        externalDeliverables: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!item) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const attrs = (
      item.productAttrs && typeof item.productAttrs === "object"
        ? item.productAttrs
        : {}
    ) as Record<string, unknown>;
    const attr = (key: string): string => {
      const value = attrs[key];
      return typeof value === "string" ? value : "";
    };

    const deliverable = item.externalDeliverables[0] ?? null;
    const issuedAtDate =
      deliverable?.issuedAt ?? item.request.closedAt ?? item.request.updatedAt;
    const org = item.request.organisation;
    const address = [org.addressLine1, org.addressLine2, org.city, org.region, org.country]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(", ");

    const now = new Date();
    const pdf = await renderScocCertificatePdf({
      locale,
      certificateNumber: deliverable?.externalRefValue ?? item.request.requestNo,
      issueDate: fmtDate(issuedAtDate),
      expirationDate: fmtDate(addDays(issuedAtDate, SCOC_CERT_VALIDITY_DAYS)),
      establishmentAddress: address || (org.nationalAddress ?? ""),
      shipmentCountry: attr("country_of_origin"),
      brandName: item.brand ?? "",
      tradeMark: attr("trade_mark"),
      productName: locale === "ar" ? item.productNameAr : item.productNameEn,
      productDescription: attr("product_description"),
      countryOfOrigin: attr("country_of_origin"),
      productionDate: attr("production_date"),
      hsCode: attr("hs_code"),
      technicalRegulation: attr("technical_regulation"),
      manufacturerName: attr("manufacturer"),
      exporterAddress: attr("exporter_address"),
      generatedAt: `${fmtDate(now)}-${now.toISOString().slice(11, 16)}`,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="scoc-certificate-${item.request.requestNo}.pdf"`,
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
