import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toNumber } from "@/lib/pricing";
import {
  checkPermission,
  requirePermission,
  scopedOrganisationId,
} from "@/lib/rbac";
import {
  endOfDayInclusive,
  startOfDay,
  statementBalances,
} from "@/lib/statement-balance";
import { withRunningBalance } from "@/server/finance/aging";
import { sumBalance } from "@/server/finance/ledger";
import { renderStatementPdf } from "@/server/finance/pdf-templates";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const querySchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  locale: z.enum(["ar", "en"]).optional(),
  orgId: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      locale: searchParams.get("locale") === "en" ? "en" : "ar",
      orgId: searchParams.get("orgId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    }

    const locale = parsed.data.locale ?? "ar";
    let orgId: string;

    if (checkPermission(session, "finance:admin")) {
      if (!parsed.data.orgId) {
        return NextResponse.json({ error: "ORG_REQUIRED" }, { status: 400 });
      }
      orgId = parsed.data.orgId;
    } else {
      requirePermission(session, "finance:client");
      orgId = scopedOrganisationId(session);
      if (parsed.data.orgId && parsed.data.orgId !== orgId) {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }

    const from = parsed.data.from ? startOfDay(parsed.data.from) : null;
    const to = parsed.data.to ? endOfDayInclusive(parsed.data.to) : null;
    if (parsed.data.from && !from) {
      return NextResponse.json({ error: "INVALID_FROM" }, { status: 400 });
    }
    if (parsed.data.to && !to) {
      return NextResponse.json({ error: "INVALID_TO" }, { status: 400 });
    }

    const org = await prisma.organisation.findFirst({
      where: { id: orgId, type: "CLIENT" },
    });
    if (!org) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const allEntries = await prisma.ledgerEntry.findMany({
      where: { organisationId: orgId },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    });

    const periodEntries =
      from || to
        ? allEntries.filter((e) => {
            if (from && e.entryDate < from) return false;
            if (to && e.entryDate > to) return false;
            return true;
          })
        : allEntries;

    const { balance } = statementBalances({
      allEntries,
      periodEntries,
      creditLimit: org.creditLimit,
    });

    const openingEntries =
      from || to
        ? allEntries.filter((e) => {
            if (from && e.entryDate < from) return true;
            return false;
          })
        : [];
    const openingBalance = sumBalance(openingEntries);

    const rows = withRunningBalance(
      periodEntries,
      "client",
      openingBalance,
    ).map((r) => ({
      date: r.entryDate.slice(0, 10),
      description: locale === "ar" ? r.descriptionAr : r.descriptionEn,
      reference: `${r.referenceType}:${r.referenceId.slice(0, 8)}`,
      debit: r.debit,
      credit: r.credit,
      running: r.runningBalance,
    }));

    const pdf = await renderStatementPdf({
      locale,
      organisationName: locale === "ar" ? org.nameAr : org.nameEn,
      generatedAt: new Date().toISOString().slice(0, 10),
      balance: toNumber(balance),
      rows,
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="statement-${orgId.slice(0, 8)}.pdf"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
