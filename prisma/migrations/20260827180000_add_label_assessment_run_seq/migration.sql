-- Guards long-running machine writers (extraction worker, rule engines)
-- against a re-evaluation that reset the assessment underneath them.
ALTER TABLE "LabelAssessment" ADD COLUMN "runSeq" INTEGER NOT NULL DEFAULT 0;
