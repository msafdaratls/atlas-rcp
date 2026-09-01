import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { requirePermission, scopedOrganisationId } from "@/lib/rbac";
import {
  renderReportPdf,
  type ReportPdfItem,
  type ReportPdfInput,
} from "@/server/finance/pdf-templates";
import { requestStateLabel } from "@/server/notifications/copy";
import {
  computeAssessment,
  parseCheckSets,
  type AssessmentState,
} from "@/lib/assessment";
import { parseSnapshot } from "@/lib/tariff-evaluation-services";
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
          include: {
            serviceItem: {
              select: { nameEn: true, nameAr: true, checkSets: true },
            },
            tariffEvaluation: {
              include: {
                technicalRegulation: {
                  select: { titleEn: true, titleAr: true },
                },
              },
            },
          },
        },
        events: {
          where: {
            toState: { in: ["TECHNICAL_REVIEW", "DECISION", "REPORT_ISSUED"] },
          },
          orderBy: { createdAt: "asc" },
          include: {
            actor: { select: { fullNameEn: true, fullNameAr: true } },
          },
        },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    const issuedEvent = [...row.events]
      .reverse()
      .find((e) => e.toState === "REPORT_ISSUED");
    const issuedAt = (
      issuedEvent?.createdAt ??
      row.closedAt ??
      row.updatedAt
    )
      .toISOString()
      .slice(0, 10);

    const actorName = (
      toState: "TECHNICAL_REVIEW" | "DECISION" | "REPORT_ISSUED",
    ): string | null => {
      const event = [...row.events].reverse().find((e) => e.toState === toState);
      if (!event) return null;
      return locale === "ar" ? event.actor.fullNameAr : event.actor.fullNameEn;
    };

    // SCOC skips the Technical Review hop entirely (ASSESSMENT_RUNNING lands
    // straight on DECISION) — only render this section for requests that
    // actually passed through TECHNICAL_REVIEW, so a SCOC report doesn't show
    // a spurious "0 / N, Incomplete" section for a review that never happened.
    const wentThroughTechnicalReview = row.events.some(
      (e) => e.toState === "TECHNICAL_REVIEW",
    );

    const technicalReviewChecklistDef = wentThroughTechnicalReview
      ? await prisma.technicalReviewChecklist
          .findUnique({ where: { id: "singleton" } })
          .catch(() => null)
      : null;

    let technicalReviewSummary: ReportPdfInput["technicalReviewSummary"] = null;
    if (technicalReviewChecklistDef) {
      const checkSets = parseCheckSets(technicalReviewChecklistDef.checkSets);
      const state = (row.technicalReviewChecklist ?? {}) as AssessmentState;
      const summary = computeAssessment(checkSets, state);
      if (summary.total > 0) {
        technicalReviewSummary = {
          compliant: summary.compliant,
          total: summary.total,
          decision: summary.recommendation,
        };
      }
    }

    const items: ReportPdfItem[] = row.items.map((item) => {
      const productName =
        locale === "ar" ? item.productNameAr : item.productNameEn;
      const serviceName =
        locale === "ar" ? item.serviceItem.nameAr : item.serviceItem.nameEn;

      if (item.tariffEvaluation) {
        const evaluation = item.tariffEvaluation;
        const snapshot = parseSnapshot(evaluation.templateSnapshot);
        const sectionVerdicts = (evaluation.sectionVerdicts ?? {}) as Record<
          string,
          AssessmentState
        >;
        let compliant = 0;
        let total = 0;
        if (snapshot) {
          for (const section of snapshot.sections) {
            const summary = computeAssessment(section.checkSets, {
              verdicts: sectionVerdicts[section.key]?.verdicts ?? {},
            });
            compliant += summary.compliant;
            total += summary.total;
          }
        }
        return {
          productName,
          serviceName,
          technicalRegulation: evaluation.technicalRegulation
            ? locale === "ar"
              ? evaluation.technicalRegulation.titleAr
              : evaluation.technicalRegulation.titleEn
            : null,
          checklistCompliant: total > 0 ? compliant : null,
          checklistTotal: total > 0 ? total : null,
          decision: evaluation.finalDecision,
        };
      }

      const checkSets = parseCheckSets(item.serviceItem.checkSets);
      const state = (item.assessment ?? {}) as AssessmentState;
      const summary = computeAssessment(checkSets, state);
      return {
        productName,
        serviceName,
        technicalRegulation: null,
        checklistCompliant: summary.total > 0 ? summary.compliant : null,
        checklistTotal: summary.total > 0 ? summary.total : null,
        decision: summary.total > 0 ? summary.recommendation : null,
      };
    });

    const stateLabel = requestStateLabel(row.state);

    const pdf = await renderReportPdf({
      locale,
      requestNo: row.requestNo,
      organisationName:
        locale === "ar" ? row.organisation.nameAr : row.organisation.nameEn,
      issuedAt,
      state: stateLabel
        ? locale === "ar"
          ? stateLabel.ar
          : stateLabel.en
        : row.state,
      items,
      technicalReviewSummary,
      evaluatorName: actorName("TECHNICAL_REVIEW"),
      reviewerName: actorName("DECISION"),
      decisionMakerName: actorName("REPORT_ISSUED"),
      generatedAt: new Date().toISOString().slice(0, 10),
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
