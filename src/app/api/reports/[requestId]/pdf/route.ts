import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission, scopedOrganisationId } from "@/lib/rbac";
import { renderReportPdf } from "@/server/finance/pdf-templates";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };

const requestIdSchema = z.string().cuid();

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

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    const isAtlas = session.organisation.type === "ATLAS";
    if (isAtlas) {
      requirePermission(session, "requests:admin");
    } else {
      requirePermission(session, "requests:read");
    }
    const { requestId: rawId } = await params;
    const idParsed = requestIdSchema.safeParse(rawId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    const requestId = idParsed.data;
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "en" ? "en" : "ar";

    const row = await prisma.request.findFirst({
      where: {
        id: requestId,
        ...(isAtlas ? {} : { organisationId: scopedOrganisationId(session) }),
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
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const issuedAt = (
      row.events[0]?.createdAt ??
      row.closedAt ??
      row.updatedAt
    )
      .toISOString()
      .slice(0, 10);

    const pdf = await renderReportPdf({
      locale,
      requestNo: row.requestNo,
      organisationName:
        locale === "ar" ? row.organisation.nameAr : row.organisation.nameEn,
      productName: row.items
        .map((i) => (locale === "ar" ? i.productNameAr : i.productNameEn))
        .join(", "),
      serviceName: row.items
        .map((i) => (locale === "ar" ? i.serviceItem.nameAr : i.serviceItem.nameEn))
        .join(", "),
      issuedAt,
      state: row.state,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report-${row.requestNo}.pdf"`,
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
