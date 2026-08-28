-- CreateEnum
CREATE TYPE "StandardKind" AS ENUM ('GENERAL', 'SPECIFIC');

-- CreateEnum
CREATE TYPE "AssessmentDecisionDb" AS ENUM ('ACCEPTED', 'ACCEPTED_WITH_REMARKS', 'REJECTED', 'INCOMPLETE');

-- CreateTable
CREATE TABLE "TechnicalRegulation" (
    "id" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "generalChecklist" JSONB NOT NULL DEFAULT '[]',
    "labelingChecklist" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "TechnicalRegulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Standard" (
    "id" TEXT NOT NULL,
    "technicalRegulationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT NOT NULL,
    "kind" "StandardKind" NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "Standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffItem" (
    "id" TEXT NOT NULL,
    "technicalRegulationId" TEXT NOT NULL,
    "hsCode" TEXT NOT NULL,
    "productTitleEn" TEXT NOT NULL,
    "productTitleAr" TEXT NOT NULL,
    "generalStandardId" TEXT,
    "specificStandardId" TEXT,
    "requiredCertificates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conformityModule" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TariffItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TariffEvaluation" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "technicalRegulationId" TEXT NOT NULL,
    "tariffItemId" TEXT NOT NULL,
    "generalVerdicts" JSONB NOT NULL DEFAULT '{}',
    "labelingVerdicts" JSONB NOT NULL DEFAULT '{}',
    "specificVerdicts" JSONB NOT NULL DEFAULT '{}',
    "finalDecision" "AssessmentDecisionDb",
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "TariffEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnicalRegulation_serviceItemId_active_idx" ON "TechnicalRegulation"("serviceItemId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "TechnicalRegulation_serviceItemId_code_key" ON "TechnicalRegulation"("serviceItemId", "code");

-- CreateIndex
CREATE INDEX "Standard_technicalRegulationId_kind_idx" ON "Standard"("technicalRegulationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Standard_technicalRegulationId_code_key" ON "Standard"("technicalRegulationId", "code");

-- CreateIndex
CREATE INDEX "TariffItem_technicalRegulationId_idx" ON "TariffItem"("technicalRegulationId");

-- CreateIndex
CREATE UNIQUE INDEX "TariffItem_technicalRegulationId_hsCode_key" ON "TariffItem"("technicalRegulationId", "hsCode");

-- CreateIndex
CREATE UNIQUE INDEX "TariffEvaluation_requestItemId_key" ON "TariffEvaluation"("requestItemId");

-- CreateIndex
CREATE INDEX "TariffEvaluation_tariffItemId_idx" ON "TariffEvaluation"("tariffItemId");

-- AddForeignKey
ALTER TABLE "TechnicalRegulation" ADD CONSTRAINT "TechnicalRegulation_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Standard" ADD CONSTRAINT "Standard_technicalRegulationId_fkey" FOREIGN KEY ("technicalRegulationId") REFERENCES "TechnicalRegulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffItem" ADD CONSTRAINT "TariffItem_technicalRegulationId_fkey" FOREIGN KEY ("technicalRegulationId") REFERENCES "TechnicalRegulation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffItem" ADD CONSTRAINT "TariffItem_generalStandardId_fkey" FOREIGN KEY ("generalStandardId") REFERENCES "Standard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffItem" ADD CONSTRAINT "TariffItem_specificStandardId_fkey" FOREIGN KEY ("specificStandardId") REFERENCES "Standard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffEvaluation" ADD CONSTRAINT "TariffEvaluation_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TariffEvaluation" ADD CONSTRAINT "TariffEvaluation_tariffItemId_fkey" FOREIGN KEY ("tariffItemId") REFERENCES "TariffItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
