-- Reconcile the Cosmetics "Choose a service" pills (SubCategory rows) with
-- the 3 real Cosmetics offerings: Technical Label Assessment, Product
-- Registration, Certificate of Conformity (SCOC).
--
-- Cosmetics had accumulated dead pills: migration 20260725120000 seeded 5
-- SubCategory rows, then 20260806052126 deactivated their child ServiceItems
-- when the catalogue was reconciled to the 4-service SFDA-COS-001..004 set —
-- but left the SubCategory rows themselves active, so 4 empty pills stayed
-- visible. A further stray row ("Shipment conformity certificate") was
-- created directly against prod via the admin catalogue UI, outside any
-- migration, so its code is unknown here.
--
-- Deactivate everything under Cosmetics except the two known-good rows —
-- this also removes the stray admin-created row without needing its code.
UPDATE "SubCategory" SET "active" = false
WHERE "mainCategoryId" = (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS')
  AND "code" NOT IN ('COSMETIC_LABELLING', 'SFDA_CERTIFICATION');

-- "Cosmetic Labelling" keeps its one child service (Technical Label
-- Assessment, SFDA-COS-001) — rename the pill to match it exactly.
UPDATE "SubCategory"
SET "nameEn" = 'Technical Label Assessment',
    "nameAr" = 'التقييم الفني لملصق المنتج',
    "sortOrder" = 1
WHERE "code" = 'COSMETIC_LABELLING'
  AND "mainCategoryId" = (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS');

-- "SFDA Certification" keeps the SCOC service (SFDA-COS-002); GHAD Product
-- Registration moves out to its own new pill below.
UPDATE "SubCategory"
SET "nameEn" = 'Certificate of Conformity (SCOC)',
    "nameAr" = 'شهادة مطابقة الإرسالية (SCOC)',
    "descEn" = 'SCOC issuance after completing the conformity assessment process for cosmetics.',
    "descAr" = 'إصدار شهادة مطابقة إرسالية لمستحضرات التجميل بعد استكمال إجراءات تقييم المطابقة.',
    "sortOrder" = 3
WHERE "code" = 'SFDA_CERTIFICATION'
  AND "mainCategoryId" = (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS');

-- New pill: Product Registration, holding GHAD Product Registration
-- (SFDA-COS-003).
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active")
VALUES (
  'sub_cosmetic_product_registration',
  (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'),
  'PRODUCT_REGISTRATION',
  'Product Registration',
  'تسجيل المنتج',
  'GHAD registration for cosmetic products.',
  'تسجيل المنتجات التجميلية في نظام غد.',
  2,
  true
)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;

UPDATE "ServiceItem"
SET "subCategoryId" = (
  SELECT "id" FROM "SubCategory"
  WHERE "mainCategoryId" = (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS')
    AND "code" = 'PRODUCT_REGISTRATION'
)
WHERE "code" = 'SFDA-COS-003';

-- Deactivate FASAH Shipment Certificate Application (SFDA-COS-004) — not one
-- of the 3 Cosmetics offerings currently shown; kept rather than deleted so
-- historical RequestItem rows keep a valid FK.
UPDATE "ServiceItem" SET "active" = false WHERE "code" = 'SFDA-COS-004';
