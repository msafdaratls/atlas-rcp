-- AlterTable
ALTER TABLE "RequestItemActivity" ADD COLUMN     "laboratoryId" TEXT,
ADD COLUMN     "sampleCarrier" TEXT,
ADD COLUMN     "sampleReceivedAt" TIMESTAMP(3),
ADD COLUMN     "sampleSentAt" TIMESTAMP(3),
ADD COLUMN     "sampleTrackingNo" TEXT;

-- CreateTable
CREATE TABLE "Laboratory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "accreditationScopeEn" TEXT,
    "accreditationScopeAr" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Laboratory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descEn" TEXT,
    "descAr" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestItemRequiredTest" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "testTypeId" TEXT,
    "customLabel" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestItemRequiredTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Laboratory_code_key" ON "Laboratory"("code");

-- CreateIndex
CREATE INDEX "Laboratory_active_sortOrder_idx" ON "Laboratory"("active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TestType_code_key" ON "TestType"("code");

-- CreateIndex
CREATE INDEX "TestType_active_sortOrder_idx" ON "TestType"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "RequestItemRequiredTest_requestItemId_idx" ON "RequestItemRequiredTest"("requestItemId");

-- CreateIndex
CREATE INDEX "RequestItemRequiredTest_testTypeId_idx" ON "RequestItemRequiredTest"("testTypeId");

-- CreateIndex
CREATE INDEX "RequestItemActivity_laboratoryId_idx" ON "RequestItemActivity"("laboratoryId");

-- AddForeignKey
ALTER TABLE "RequestItemActivity" ADD CONSTRAINT "RequestItemActivity_laboratoryId_fkey" FOREIGN KEY ("laboratoryId") REFERENCES "Laboratory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemRequiredTest" ADD CONSTRAINT "RequestItemRequiredTest_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemRequiredTest" ADD CONSTRAINT "RequestItemRequiredTest_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "TestType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItemRequiredTest" ADD CONSTRAINT "RequestItemRequiredTest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
