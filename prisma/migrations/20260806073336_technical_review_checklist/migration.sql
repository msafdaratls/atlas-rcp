-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "technicalReviewChecklist" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE "TechnicalReviewChecklist" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "checkSets" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "TechnicalReviewChecklist_pkey" PRIMARY KEY ("id")
);
