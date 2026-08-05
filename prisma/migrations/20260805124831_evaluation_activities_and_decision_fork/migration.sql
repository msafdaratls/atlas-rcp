-- CreateEnum
CREATE TYPE "EvaluationActivityType" AS ENUM ('SHIPMENT_INSPECTION', 'LABORATORY_TESTING', 'FACTORY_AUDIT');

-- CreateEnum
CREATE TYPE "EvaluationActivityStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "RequestDocument" ADD COLUMN     "activityId" TEXT;

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "requiresFactoryAudit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresInspection" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresLabTesting" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RequestItemActivity" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "type" "EvaluationActivityType" NOT NULL,
    "status" "EvaluationActivityStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledDate" TIMESTAMP(3),
    "assignedUserId" TEXT,
    "qualificationNote" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequestItemActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestItemActivity_requestItemId_type_idx" ON "RequestItemActivity"("requestItemId", "type");

-- CreateIndex
CREATE INDEX "RequestDocument_activityId_idx" ON "RequestDocument"("activityId");

-- AddForeignKey
ALTER TABLE "RequestDocument" ADD CONSTRAINT "RequestDocument_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "RequestItemActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemActivity" ADD CONSTRAINT "RequestItemActivity_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemActivity" ADD CONSTRAINT "RequestItemActivity_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemActivity" ADD CONSTRAINT "RequestItemActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
