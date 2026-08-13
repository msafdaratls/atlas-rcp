import { prisma } from "@/lib/db";
import { getExtractionProvider } from "@/server/label-eval/extraction/provider";

/**
 * Drains LabelExtractionJob, mirroring processOutboxBatch
 * (src/server/notifications/worker.ts) — the only async-job pattern already
 * in this repo. No HTTP request ever blocks on extraction (design doc §5):
 * the "start evaluation" action only creates the job row; this worker picks
 * it up on the next tick.
 */

const BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000];

export async function processExtractionJobBatch(limit = 10): Promise<number> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 5 * 60 * 1000);

  // Reclaim stuck PROCESSING rows (worker crash / deploy mid-run).
  await prisma.labelExtractionJob.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleBefore } },
    data: { status: "PENDING", nextAttemptAt: now },
  });

  const pending = await prisma.labelExtractionJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });

  let processed = 0;
  const provider = getExtractionProvider();

  for (const job of pending) {
    const claimed = await prisma.labelExtractionJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PROCESSING", updatedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    try {
      const assessment = await prisma.labelAssessment.findUniqueOrThrow({
        where: { id: job.assessmentId },
        select: {
          id: true,
          domain: true,
          documents: { select: { kind: true, storageKey: true, mimeType: true } },
        },
      });

      const results = await provider.extract(assessment.domain, assessment.documents);

      await prisma.$transaction([
        ...results.map((r) =>
          prisma.labelExtractedField.upsert({
            where: { assessmentId_fieldKey: { assessmentId: assessment.id, fieldKey: r.fieldKey } },
            create: {
              assessmentId: assessment.id,
              fieldKey: r.fieldKey,
              valueEn: r.valueEn,
              valueAr: r.valueAr,
              sourceEngine: provider.name,
              confidence: r.confidence,
              needsReview: r.needsReview,
            },
            update: {
              valueEn: r.valueEn,
              valueAr: r.valueAr,
              sourceEngine: provider.name,
              confidence: r.confidence,
              needsReview: r.needsReview,
            },
          }),
        ),
        prisma.labelAssessment.update({
          where: { id: assessment.id },
          data: { status: "AWAITING_REVIEW" },
        }),
        prisma.labelExtractionJob.update({
          where: { id: job.id },
          data: { status: "SENT", lastError: null, attempts: { increment: 1 } },
        }),
      ]);
      processed += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "EXTRACTION_FAILED";
      const dead = attempts >= BACKOFF_MS.length;
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;

      await prisma.$transaction([
        prisma.labelExtractionJob.update({
          where: { id: job.id },
          data: {
            status: dead ? "FAILED" : "PENDING",
            attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: dead ? new Date() : new Date(Date.now() + delay),
          },
        }),
        ...(dead
          ? [prisma.labelAssessment.update({ where: { id: job.assessmentId }, data: { status: "ERROR" } })]
          : []),
      ]);
    }
  }

  return processed;
}
