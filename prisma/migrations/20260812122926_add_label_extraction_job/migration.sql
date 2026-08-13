-- CreateTable
CREATE TABLE "LabelExtractionJob" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabelExtractionJob_assessmentId_key" ON "LabelExtractionJob"("assessmentId");

-- CreateIndex
CREATE INDEX "LabelExtractionJob_status_nextAttemptAt_idx" ON "LabelExtractionJob"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "LabelExtractionJob" ADD CONSTRAINT "LabelExtractionJob_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
