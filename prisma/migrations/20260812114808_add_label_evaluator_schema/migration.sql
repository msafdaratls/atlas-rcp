-- CreateEnum
CREATE TYPE "LabelEvalDomain" AS ENUM ('SFDA_SUPPLEMENTS', 'COSMETICS');

-- CreateEnum
CREATE TYPE "LabelKbStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LabelDocumentKind" AS ENUM ('ARTWORK', 'INGREDIENT_LIST');

-- CreateEnum
CREATE TYPE "LabelRuleType" AS ENUM ('CHECKLIST_ITEM', 'LABEL_REQUIREMENT_ITEM', 'CLAIM_PHASE_ITEM', 'REQUIRED_TEST_RULE');

-- CreateEnum
CREATE TYPE "LabelAssessmentStatus" AS ENUM ('EXTRACTING', 'AWAITING_REVIEW', 'CLASSIFYING', 'ASSESSED', 'BLOCKED_NO_CATEGORY_MATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "LabelVerdict" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'NA', 'NEEDS_REVIEW', 'REQUIRES_ADDITIONAL_DATA');

-- CreateTable
CREATE TABLE "LabelKbVersion" (
    "id" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LabelKbStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    "checksum" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "LabelKbVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelKbRule" (
    "id" TEXT NOT NULL,
    "kbVersionId" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,
    "ruleType" "LabelRuleType" NOT NULL,
    "code" TEXT NOT NULL,
    "section" TEXT,
    "titleEn" TEXT,
    "titleAr" TEXT NOT NULL,
    "priority" TEXT,
    "evaluatorKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "autoVerifiable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LabelKbRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelKbLookup" (
    "id" TEXT NOT NULL,
    "kbVersionId" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,
    "tableKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "LabelKbLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelKbCategory" (
    "id" TEXT NOT NULL,
    "kbVersionId" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "icon" TEXT,
    "properties" JSONB NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LabelKbCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelEvalServiceMapping" (
    "id" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,

    CONSTRAINT "LabelEvalServiceMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelAssessment" (
    "id" TEXT NOT NULL,
    "domain" "LabelEvalDomain" NOT NULL,
    "kbVersionId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "requestNo" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "organisationName" TEXT NOT NULL,
    "serviceItemCode" TEXT NOT NULL,
    "documentsFingerprint" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "status" "LabelAssessmentStatus" NOT NULL DEFAULT 'EXTRACTING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "finalVerdict" TEXT,
    "overallRate" DOUBLE PRECISION,
    "claimedByUserId" TEXT,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "LabelAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelDocument" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "kind" "LabelDocumentKind" NOT NULL,
    "sourceDocumentVersionId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "copiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelExtractedField" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "valueEn" TEXT,
    "valueAr" TEXT,
    "sourceEngine" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "originalMachineValue" JSONB,
    "confirmedByUserId" TEXT,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "LabelExtractedField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelClassification" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "detectedCategoryCode" TEXT,
    "detectedConfidence" DOUBLE PRECISION,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "overrideCategoryCode" TEXT,
    "overriddenByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "rationale" TEXT,

    CONSTRAINT "LabelClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelItemVerdict" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "kbRuleId" TEXT NOT NULL,
    "verdict" "LabelVerdict" NOT NULL,
    "autoOrManual" TEXT NOT NULL,
    "evidenceText" TEXT,
    "rationale" TEXT,
    "llmModel" TEXT,
    "llmPromptVersion" TEXT,
    "overriddenByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "previousVerdict" "LabelVerdict",

    CONSTRAINT "LabelItemVerdict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelRequiredTest" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "testCode" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "ruleCode" TEXT NOT NULL,
    "reasonEn" TEXT,
    "reasonAr" TEXT,
    "triggerSource" TEXT,
    "addedManually" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LabelRequiredTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelReport" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdfStorageKey" TEXT,
    "snapshot" JSONB NOT NULL,
    "promotedAt" TIMESTAMP(3),
    "promotedByUserId" TEXT,

    CONSTRAINT "LabelReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabelKbVersion_domain_status_idx" ON "LabelKbVersion"("domain", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LabelKbVersion_domain_versionLabel_key" ON "LabelKbVersion"("domain", "versionLabel");

-- CreateIndex
CREATE INDEX "LabelKbRule_kbVersionId_ruleType_idx" ON "LabelKbRule"("kbVersionId", "ruleType");

-- CreateIndex
CREATE UNIQUE INDEX "LabelKbRule_kbVersionId_code_key" ON "LabelKbRule"("kbVersionId", "code");

-- CreateIndex
CREATE INDEX "LabelKbLookup_kbVersionId_tableKey_idx" ON "LabelKbLookup"("kbVersionId", "tableKey");

-- CreateIndex
CREATE UNIQUE INDEX "LabelKbCategory_kbVersionId_code_key" ON "LabelKbCategory"("kbVersionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LabelEvalServiceMapping_serviceItemId_key" ON "LabelEvalServiceMapping"("serviceItemId");

-- CreateIndex
CREATE INDEX "LabelEvalServiceMapping_domain_idx" ON "LabelEvalServiceMapping"("domain");

-- CreateIndex
CREATE INDEX "LabelAssessment_domain_requestItemId_createdAt_idx" ON "LabelAssessment"("domain", "requestItemId", "createdAt");

-- CreateIndex
CREATE INDEX "LabelAssessment_status_idx" ON "LabelAssessment"("status");

-- CreateIndex
CREATE INDEX "LabelAssessment_requestItemId_status_idx" ON "LabelAssessment"("requestItemId", "status");

-- CreateIndex
CREATE INDEX "LabelAssessment_documentsFingerprint_idx" ON "LabelAssessment"("documentsFingerprint");

-- CreateIndex
CREATE INDEX "LabelDocument_assessmentId_idx" ON "LabelDocument"("assessmentId");

-- CreateIndex
CREATE INDEX "LabelDocument_sha256_idx" ON "LabelDocument"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "LabelExtractedField_assessmentId_fieldKey_key" ON "LabelExtractedField"("assessmentId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "LabelClassification_assessmentId_key" ON "LabelClassification"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelItemVerdict_assessmentId_kbRuleId_key" ON "LabelItemVerdict"("assessmentId", "kbRuleId");

-- CreateIndex
CREATE INDEX "LabelRequiredTest_assessmentId_idx" ON "LabelRequiredTest"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelReport_assessmentId_key" ON "LabelReport"("assessmentId");

-- AddForeignKey
ALTER TABLE "LabelKbRule" ADD CONSTRAINT "LabelKbRule_kbVersionId_fkey" FOREIGN KEY ("kbVersionId") REFERENCES "LabelKbVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelKbLookup" ADD CONSTRAINT "LabelKbLookup_kbVersionId_fkey" FOREIGN KEY ("kbVersionId") REFERENCES "LabelKbVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelKbCategory" ADD CONSTRAINT "LabelKbCategory_kbVersionId_fkey" FOREIGN KEY ("kbVersionId") REFERENCES "LabelKbVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelAssessment" ADD CONSTRAINT "LabelAssessment_kbVersionId_fkey" FOREIGN KEY ("kbVersionId") REFERENCES "LabelKbVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelAssessment" ADD CONSTRAINT "LabelAssessment_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelDocument" ADD CONSTRAINT "LabelDocument_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelExtractedField" ADD CONSTRAINT "LabelExtractedField_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelClassification" ADD CONSTRAINT "LabelClassification_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelItemVerdict" ADD CONSTRAINT "LabelItemVerdict_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelItemVerdict" ADD CONSTRAINT "LabelItemVerdict_kbRuleId_fkey" FOREIGN KEY ("kbRuleId") REFERENCES "LabelKbRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelRequiredTest" ADD CONSTRAINT "LabelRequiredTest_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelReport" ADD CONSTRAINT "LabelReport_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LabelAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
