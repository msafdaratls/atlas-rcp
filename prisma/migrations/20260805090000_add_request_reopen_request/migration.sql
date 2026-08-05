-- CreateEnum
CREATE TYPE "ReopenRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RequestReopenRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "ReopenRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "targetState" "RequestState",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "RequestReopenRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestReopenRequest_requestId_status_idx" ON "RequestReopenRequest"("requestId", "status");

-- CreateIndex
CREATE INDEX "RequestReopenRequest_status_createdAt_idx" ON "RequestReopenRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "RequestReopenRequest" ADD CONSTRAINT "RequestReopenRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestReopenRequest" ADD CONSTRAINT "RequestReopenRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestReopenRequest" ADD CONSTRAINT "RequestReopenRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
