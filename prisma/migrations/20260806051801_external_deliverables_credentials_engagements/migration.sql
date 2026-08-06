-- CreateEnum
CREATE TYPE "DeliverableType" AS ENUM ('INTERNAL_REPORT', 'EXTERNAL_CERTIFICATE');

-- CreateEnum
CREATE TYPE "ExternalDeliverableStatus" AS ENUM ('PENDING_SUBMISSION', 'SUBMITTED', 'ISSUED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlatformType" AS ENUM ('GHAD', 'SABER', 'FASAH');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "engagementId" TEXT;

-- AlterTable
ALTER TABLE "RequestDocument" ADD COLUMN     "externalDeliverableId" TEXT;

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "platformCredentialId" TEXT,
ADD COLUMN     "sourceRequestItemId" TEXT;

-- AlterTable
ALTER TABLE "ServiceItem" ADD COLUMN     "deliverableAr" TEXT,
ADD COLUMN     "deliverableEn" TEXT,
ADD COLUMN     "deliverableType" "DeliverableType" NOT NULL DEFAULT 'INTERNAL_REPORT';

-- CreateTable
CREATE TABLE "ExternalDeliverable" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "status" "ExternalDeliverableStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "externalRefType" TEXT NOT NULL,
    "externalRefValue" TEXT,
    "submittedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDeliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "platform" "PlatformType" NOT NULL,
    "label" TEXT,
    "loginIdentifier" TEXT NOT NULL,
    "secretCiphertext" TEXT NOT NULL,
    "secretIv" TEXT NOT NULL,
    "secretAuthTag" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalDeliverable_requestItemId_status_idx" ON "ExternalDeliverable"("requestItemId", "status");

-- CreateIndex
CREATE INDEX "PlatformCredential_organisationId_platform_active_idx" ON "PlatformCredential"("organisationId", "platform", "active");

-- CreateIndex
CREATE INDEX "Engagement_organisationId_status_idx" ON "Engagement"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Request_engagementId_idx" ON "Request"("engagementId");

-- CreateIndex
CREATE INDEX "RequestDocument_externalDeliverableId_idx" ON "RequestDocument"("externalDeliverableId");

-- CreateIndex
CREATE INDEX "RequestItem_platformCredentialId_idx" ON "RequestItem"("platformCredentialId");

-- CreateIndex
CREATE INDEX "RequestItem_sourceRequestItemId_idx" ON "RequestItem"("sourceRequestItemId");

-- AddForeignKey
ALTER TABLE "Request" ADD CONSTRAINT "Request_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_platformCredentialId_fkey" FOREIGN KEY ("platformCredentialId") REFERENCES "PlatformCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_sourceRequestItemId_fkey" FOREIGN KEY ("sourceRequestItemId") REFERENCES "RequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestDocument" ADD CONSTRAINT "RequestDocument_externalDeliverableId_fkey" FOREIGN KEY ("externalDeliverableId") REFERENCES "ExternalDeliverable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDeliverable" ADD CONSTRAINT "ExternalDeliverable_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDeliverable" ADD CONSTRAINT "ExternalDeliverable_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCredential" ADD CONSTRAINT "PlatformCredential_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformCredential" ADD CONSTRAINT "PlatformCredential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
