-- Regulation workbook catalog: many-to-many specific standards, a per-regulation
-- documents checklist, per-section verdict maps, evaluation template snapshots,
-- and the staged-import audit table.
--
-- ORDER MATTERS: every backfill runs BEFORE the column it reads is dropped.

-- ─── New enum / columns ──────────────────────────────────────────────────────

CREATE TYPE "RegulationImportStatus" AS ENUM ('PENDING', 'APPLIED', 'DISCARDED');

ALTER TABLE "Standard" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TariffItem" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TechnicalRegulation" ADD COLUMN "documentsChecklist" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "TariffEvaluation"
  ADD COLUMN "sectionVerdicts" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "templateSnapshot" JSONB,
  ADD COLUMN "snapshotAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3);

-- ─── Many-to-many specific standards ─────────────────────────────────────────

CREATE TABLE "TariffItemStandard" (
    "tariffItemId" TEXT NOT NULL,
    "standardId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TariffItemStandard_pkey" PRIMARY KEY ("tariffItemId","standardId")
);
CREATE INDEX "TariffItemStandard_standardId_idx" ON "TariffItemStandard"("standardId");

ALTER TABLE "TariffItemStandard" ADD CONSTRAINT "TariffItemStandard_tariffItemId_fkey"
  FOREIGN KEY ("tariffItemId") REFERENCES "TariffItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TariffItemStandard" ADD CONSTRAINT "TariffItemStandard_standardId_fkey"
  FOREIGN KEY ("standardId") REFERENCES "Standard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill the single FK into the join BEFORE dropping it, so no link is lost.
INSERT INTO "TariffItemStandard" ("tariffItemId", "standardId", "sortOrder")
SELECT "id", "specificStandardId", 0
FROM "TariffItem"
WHERE "specificStandardId" IS NOT NULL;

ALTER TABLE "TariffItem" DROP CONSTRAINT "TariffItem_specificStandardId_fkey";
ALTER TABLE "TariffItem" DROP COLUMN "specificStandardId";

-- ─── Verdict maps: three columns -> one keyed map ────────────────────────────
-- The reader (parseSectionVerdicts) expects {sectionKey: {verdicts: {...}}},
-- NOT {sectionKey: {...}} — a bare map is skipped as malformed, which would
-- silently discard every in-flight answer the moment the old columns are
-- dropped below. Each map is therefore wrapped in its `verdicts` envelope.
--
-- Old specific verdicts had no standard id to key on (there was only ever one
-- specific standard), so they are keyed by the item's now-single link. Where an
-- item has no link the specific answers cannot be attributed and are dropped —
-- they would have been unreachable anyway.

UPDATE "TariffEvaluation" e
SET "sectionVerdicts" = jsonb_strip_nulls(
  jsonb_build_object(
    'general',  CASE WHEN e."generalVerdicts"  <> '{}'::jsonb
                     THEN jsonb_build_object('verdicts', e."generalVerdicts")  END,
    'labeling', CASE WHEN e."labelingVerdicts" <> '{}'::jsonb
                     THEN jsonb_build_object('verdicts', e."labelingVerdicts") END
  )
  || COALESCE(
       (SELECT jsonb_build_object(
                 'std:' || l."standardId",
                 jsonb_build_object('verdicts', e."specificVerdicts"))
        FROM "TariffItemStandard" l
        WHERE l."tariffItemId" = e."tariffItemId"
          AND e."specificVerdicts" <> '{}'::jsonb
        LIMIT 1),
       '{}'::jsonb)
);

ALTER TABLE "TariffEvaluation"
  DROP COLUMN "generalVerdicts",
  DROP COLUMN "labelingVerdicts",
  DROP COLUMN "specificVerdicts";

-- Every evaluation needs a snapshot it can actually be read back through:
-- parseSnapshot rejects anything without version/regulation/tariffItem, and a
-- row it rejects renders as "not started" while still being gated on a decision
-- it can no longer produce. Finished rows additionally get a completedAt so
-- that adding the documents section cannot retroactively flip them to
-- incomplete. Sections are left empty rather than guessed at — an in-flight
-- evaluation adopts the real template with one "Refresh to latest catalog",
-- which carries its migrated answers across by item code.

UPDATE "TariffEvaluation" e
SET "completedAt" = CASE
      WHEN e."finalDecision" IS NOT NULL THEN COALESCE(e."completedAt", e."updatedAt")
      ELSE e."completedAt"
    END,
    "snapshotAt" = COALESCE(e."snapshotAt", e."updatedAt"),
    "templateSnapshot" = COALESCE(e."templateSnapshot", jsonb_build_object(
      'version', 1,
      'regulation', jsonb_build_object(
        'id', r."id", 'code', r."code", 'titleEn', r."titleEn", 'titleAr', r."titleAr"),
      'tariffItem', jsonb_build_object(
        'id', t."id", 'hsCode', t."hsCode",
        'productTitleEn', t."productTitleEn", 'productTitleAr', t."productTitleAr",
        'requiredCertificates', to_jsonb(t."requiredCertificates"),
        'conformityModule', to_jsonb(t."conformityModule")),
      'generalStandards', '[]'::jsonb,
      'specificStandards', '[]'::jsonb,
      'sections', '[]'::jsonb,
      'hash', 'backfilled'
    ))
FROM "TechnicalRegulation" r, "TariffItem" t
WHERE r."id" = e."technicalRegulationId"
  AND t."id" = e."tariffItemId";

-- ─── Staged import audit table ───────────────────────────────────────────────

CREATE TABLE "RegulationImport" (
    "id" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "regulationCode" TEXT NOT NULL,
    "technicalRegulationId" TEXT,
    "sourceFilename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "catalogFingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "diff" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RegulationImportStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedByUserId" TEXT,
    "appliedAt" TIMESTAMP(3),
    CONSTRAINT "RegulationImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RegulationImport_serviceItemId_uploadedAt_idx" ON "RegulationImport"("serviceItemId", "uploadedAt");
CREATE INDEX "RegulationImport_status_idx" ON "RegulationImport"("status");

ALTER TABLE "RegulationImport" ADD CONSTRAINT "RegulationImport_serviceItemId_fkey"
  FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegulationImport" ADD CONSTRAINT "RegulationImport_technicalRegulationId_fkey"
  FOREIGN KEY ("technicalRegulationId") REFERENCES "TechnicalRegulation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
