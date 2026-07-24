import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import { requirePermission, scopedOrganisationId } from "@/lib/rbac";
import { renderInvoicePdf } from "@/server/finance/pdf-templates";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const invoiceIdSchema = z.string().cuid();

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

export async function GET(request: Request, ctx: Ctx) {
  try {
    const session = await requireSession();
    const isAtlas = session.organisation.type === "ATLAS";
    if (isAtlas) {
      requirePermission(session, "finance:admin");
    } else {
      requirePermission(session, "finance:client");
    }
    const { id: rawId } = await ctx.params;
    const idParsed = invoiceIdSchema.safeParse(rawId);
    if (!idParsed.success) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }
    const id = idParsed.data;
    const locale =
      new URL(request.url).searchParams.get("locale") === "en" ? "en" : "ar";

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        ...(isAtlas ? {} : { organisationId: scopedOrganisationId(session) }),
      },
      include: { lines: true, organisation: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const pdf = await renderInvoicePdf({
      locale,
      invoiceNo: invoice.invoiceNo,
      organisationName:
        locale === "ar"
          ? invoice.organisation.nameAr
          : invoice.organisation.nameEn,
      status: invoice.status,
      issuedAt: (invoice.issuedAt ?? invoice.createdAt).toISOString().slice(0, 10),
      subtotal: toNumber(invoice.subtotal),
      discount: toNumber(invoice.discount),
      vatAmount: toNumber(invoice.vatAmount),
      total: toNumber(invoice.total),
      lines: invoice.lines.map((l) => ({
        description: l.description,
        qty: l.qty,
        unitPrice: toNumber(l.unitPrice),
        lineTotal: toNumber(l.lineTotal),
      })),
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNo}.pdf"`,
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
