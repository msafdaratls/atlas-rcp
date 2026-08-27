import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { withRunGuard } from "@/server/label-eval/concurrency";
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

  // Reclaim stuck PROCESSING rows (worker crash / deploy mid-run). Counted as
  // an attempt and dead-lettered past BACKOFF_MS.length exactly like the
  // catch block below — a job that dies before reaching that catch (OOM
  // kill, container restart) must not bypass the attempt cap and requeue
  // indefinitely, burning a fresh Claude call every cycle forever.
  const stuck = await prisma.labelExtractionJob.findMany({
    where: { status: "PROCESSING", updatedAt: { lt: staleBefore } },
  });
  for (const job of stuck) {
    const attempts = job.attempts + 1;
    const dead = attempts >= BACKOFF_MS.length;
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    await prisma.$transaction([
      prisma.labelExtractionJob.update({
        where: { id: job.id },
        data: {
          status: dead ? "FAILED" : "PENDING",
          attempts,
          lastError: dead ? "EXTRACTION_STALLED_REPEATEDLY" : job.lastError,
          nextAttemptAt: dead ? now : new Date(now.getTime() + delay),
        },
      }),
      ...(dead
        ? [prisma.labelAssessment.update({ where: { id: job.assessmentId }, data: { status: "ERROR" } })]
        : []),
    ]);
  }

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
          runSeq: true,
          documents: { select: { kind: true, storageKey: true, mimeType: true } },
        },
      });

      const results = await provider.extract(assessment.domain, assessment.documents);

      // Guarded write-back: a reviewer can re-evaluate at any stage, including
      // while this job is inside provider.extract(). Without the guard the
      // superseded run would upsert fields read from documents the reset has
      // already deleted, flip the fresh run to AWAITING_REVIEW, and mark the
      // requeued job SENT so the new extraction never ran at all.
      const applied = await withRunGuard(assessment.id, assessment.runSeq, async (tx) => {
        // Also still ours to finish: the stuck-job sweep above can requeue a
        // PROCESSING job it judged stalled while this one is still running.
        const stillClaimed = await tx.labelExtractionJob.updateMany({
          where: { id: job.id, status: "PROCESSING" },
          data: { status: "SENT", lastError: null, attempts: { increment: 1 } },
        });
        if (stillClaimed.count === 0) return false;

        for (const r of results) {
          await tx.labelExtractedField.upsert({
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
          });
        }

        await tx.labelAssessment.update({
          where: { id: assessment.id },
          data: { status: "AWAITING_REVIEW" },
        });
        return true;
      });

      if (applied) {
        processed += 1;
      } else {
        log.warn("label-eval.extraction", "discarded a superseded extraction result", {
          assessmentId: assessment.id,
          jobId: job.id,
        });
      }
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : "EXTRACTION_FAILED";
      const dead = attempts >= BACKOFF_MS.length;
      const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;

      // Guarded on PROCESSING for the same reason the success path is: if a
      // re-evaluation requeued this job (status PENDING, attempts 0) while
      // the failing attempt was still running, recording that failure would
      // burn an attempt on — and possibly dead-letter into ERROR — a fresh
      // run that has not been tried once.
      await prisma.$transaction(async (tx) => {
        const stillClaimed = await tx.labelExtractionJob.updateMany({
          where: { id: job.id, status: "PROCESSING" },
          data: {
            status: dead ? "FAILED" : "PENDING",
            attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: dead ? new Date() : new Date(Date.now() + delay),
          },
        });
        if (stillClaimed.count === 0) {
          log.warn("label-eval.extraction", "discarded a superseded extraction failure", {
            assessmentId: job.assessmentId,
            jobId: job.id,
            error: message.slice(0, 200),
          });
          return;
        }
        if (dead) {
          await tx.labelAssessment.updateMany({
            where: { id: job.assessmentId, status: "EXTRACTING" },
            data: { status: "ERROR" },
          });
        }
      });
    }
  }

  return processed;
}
