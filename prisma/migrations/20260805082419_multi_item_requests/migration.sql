-- Data-preserving migration: split Request.serviceItemId (+ per-request
-- product/assessment fields) into a new RequestItem child table, so a
-- request can hold multiple service items. Every existing Request becomes a
-- Request with exactly one RequestItem, carrying over its current values.

-- 1. Create the new table (no NOT NULL FK yet on RequestDocument).
CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "serviceItemId" TEXT NOT NULL,
    "productNameEn" TEXT NOT NULL DEFAULT '',
    "productNameAr" TEXT NOT NULL DEFAULT '',
    "brand" TEXT,
    "productAttrs" JSONB NOT NULL DEFAULT '{}',
    "assessment" JSONB NOT NULL DEFAULT '{}',
    "basePrice" DECIMAL(14,2) NOT NULL,
    "vatRate" DECIMAL(5,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RequestItem_requestId_idx" ON "RequestItem"("requestId");
CREATE INDEX "RequestItem_serviceItemId_idx" ON "RequestItem"("serviceItemId");

ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_serviceItemId_fkey" FOREIGN KEY ("serviceItemId") REFERENCES "ServiceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Backfill: one RequestItem per existing Request, carrying over its
-- current serviceItemId/product fields and a price/VAT snapshot from the
-- joined ServiceItem (falling back to the request's own priceCharged/1 if
-- the service item was somehow deleted, which the FK prevents going forward).
INSERT INTO "RequestItem" ("id", "requestId", "serviceItemId", "productNameEn", "productNameAr", "brand", "productAttrs", "assessment", "basePrice", "vatRate", "sortOrder")
SELECT
    'ritem_' || r."id",
    r."id",
    r."serviceItemId",
    r."productNameEn",
    r."productNameAr",
    r."brand",
    r."productAttrs",
    r."assessment",
    si."basePrice",
    si."vatRate",
    0
FROM "Request" r
JOIN "ServiceItem" si ON si."id" = r."serviceItemId";

-- 3. Point every existing RequestDocument at the (single) RequestItem that
-- belongs to its request, then make the column required.
ALTER TABLE "RequestDocument" ADD COLUMN "requestItemId" TEXT;

UPDATE "RequestDocument" rd
SET "requestItemId" = ri."id"
FROM "RequestItem" ri
WHERE ri."requestId" = rd."requestId";

ALTER TABLE "RequestDocument" ALTER COLUMN "requestItemId" SET NOT NULL;

CREATE INDEX "RequestDocument_requestItemId_idx" ON "RequestDocument"("requestItemId");
ALTER TABLE "RequestDocument" ADD CONSTRAINT "RequestDocument_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Drop the now-redundant per-request scalar columns/constraints from
-- Request; these live on RequestItem now.
ALTER TABLE "Request" DROP CONSTRAINT "Request_serviceItemId_fkey";
DROP INDEX "Request_serviceItemId_idx";

ALTER TABLE "Request" DROP COLUMN "assessment",
DROP COLUMN "brand",
DROP COLUMN "productAttrs",
DROP COLUMN "productNameAr",
DROP COLUMN "productNameEn",
DROP COLUMN "serviceItemId";
