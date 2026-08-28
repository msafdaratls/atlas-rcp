import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/rbac";
import { storage } from "@/lib/storage";
import { getAssessmentDetail } from "@/server/label-eval/queries";
import { renderAssessmentReportPdf } from "@/server/label-eval/report-pdf";

export const runtime = "nodejs";

type Params = { params: Promise<{ assessmentId: string }> };

const assessmentIdSchema = z.string().cuid();

function mapError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "UNAUTHORIZED";
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}

/**
 * Generates and downloads a detailed evaluation report for one
 * LabelAssessment (design doc's "report engine"). Available once the run has
 * scored (ASSESSED / BLOCKED_NO_CATEGORY_MATCH) — not while extraction or
 * manual entry is still in progress, since the checklist wouldn't be final.
 * Every call re-renders from the assessment's current data (an override made
 * after a previous download is reflected on the next one) and refreshes
 * LabelReport.pdfStorageKey + generatedAt as a side effect, so the stored
 * copy always matches the most recently downloaded one.
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireSession();
    requirePermission(session, "requests:admin");

    const { assessmentId: rawId } = await params;
    const idParsed = assessmentIdSchema.safeParse(rawId);
    if (!idParsed.success) return NextResponse.json({ error: "VALIDATION" }, { status: 400 });
    const assessmentId = idParsed.data;

    const detail = await getAssessmentDetail(assessmentId);
    if (!detail) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

    const scoredStatuses = new Set(["ASSESSED", "BLOCKED_NO_CATEGORY_MATCH"]);
    if (!scoredStatuses.has(detail.status)) {
      return NextResponse.json({ error: "NOT_SCORED" }, { status: 409 });
    }

    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "en" ? "en" : "ar";

    const item = detail.requestItemId
      ? await prisma.requestItem.findUnique({
          where: { id: detail.requestItemId },
          select: { productNameEn: true, productNameAr: true, brand: true },
        })
      : null;

    const [evaluator, reviewer] = await Promise.all([
      detail.confirmedAt
        ? prisma.labelAssessment
            .findUnique({ where: { id: assessmentId }, select: { confirmedByUserId: true } })
            .then((a) =>
              a?.confirmedByUserId
                ? prisma.user.findUnique({ where: { id: a.confirmedByUserId }, select: { fullNameEn: true } })
                : null,
            )
        : null,
      detail.promotedAt
        ? prisma.labelReport
            .findUnique({ where: { assessmentId }, select: { promotedByUserId: true } })
            .then((r) =>
              r?.promotedByUserId
                ? prisma.user.findUnique({ where: { id: r.promotedByUserId }, select: { fullNameEn: true } })
                : null,
            )
        : null,
    ]);

    const generatedAt = new Date();
    const reportRef = `EVAL-${detail.domain === "SFDA_SUPPLEMENTS" ? "SFDA" : "COS"}-${assessmentId.slice(-8).toUpperCase()}`;

    const pdf = await renderAssessmentReportPdf({
      locale,
      detail,
      reportRef,
      generatedAt: generatedAt.toISOString().slice(0, 16).replace("T", " "),
      productNameEn: item?.productNameEn ?? null,
      productNameAr: item?.productNameAr ?? null,
      brand: item?.brand ?? null,
      evaluatorName: evaluator?.fullNameEn ?? null,
      reviewerName: reviewer?.fullNameEn ?? null,
    });

    const stored = await storage.put({
      keyPrefix: `label-reports/${assessmentId}`,
      fileName: `report-${reportRef}.pdf`,
      mimeType: "application/pdf",
      body: pdf,
    });

    await prisma.labelReport.upsert({
      where: { assessmentId },
      create: { assessmentId, snapshot: {}, pdfStorageKey: stored.key, generatedAt },
      update: { pdfStorageKey: stored.key, generatedAt },
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportRef}.pdf"`,
      },
    });
  } catch (error) {
    return mapError(error);
  }
}
