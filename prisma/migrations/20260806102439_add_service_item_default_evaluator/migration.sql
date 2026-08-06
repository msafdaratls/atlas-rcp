-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "defaultEvaluatorId" TEXT;

-- CreateIndex
CREATE INDEX "ServiceItem_defaultEvaluatorId_idx" ON "ServiceItem"("defaultEvaluatorId");

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_defaultEvaluatorId_fkey" FOREIGN KEY ("defaultEvaluatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
