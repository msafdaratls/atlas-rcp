-- Bring the SAB-001 (PCOC) required-document label/help corrections from
-- prisma/seed.ts into already-seeded rows.
--
-- prisma/seed.ts is never run in production (`prisma migrate deploy` only),
-- so editing it alone leaves live rows untouched. Same approach as
-- 20260823140000_fix_arabic_translation_content: scope every UPDATE by the
-- document `code` plus the service item's `code`, so it can only ever touch
-- the three SAB-001 slots and no other service reusing the same codes.
--
-- Three corrections, all driven by the blank forms the client supplied
-- (prisma/seed-assets/document-templates/):
--
--   1. IMPORTER_DECLARATION is labelled "Importer declaration", but the form
--      itself is titled "Supplier Declaration of Conformity" and the client's
--      own instructions call it the Supplier Declaration. The `code` stays
--      IMPORTER_DECLARATION — it is the stable key that existing
--      RequestDocument rows point at — and only the display name changes.
--
--   2. MANUFACTURER_DECLARATION told clients to fill the form out "on your
--      Importer Header Letter". The manufacturer form is headed
--      "Manufacturer Letterhead"; the instruction named the wrong party.
--      Its Arabic label also read "إقرار المصنّع" where the form itself says
--      "إقرار الصانع".
--
--   3. Both declarations are standardised and may be reused across every
--      product on a request, while the risk assessment is product-specific
--      and needs one form per product. Neither fact was stated anywhere in
--      the UI. RISK_ASSESSMENT additionally promised "Download the
--      template," but no blank risk-assessment form has been supplied, so
--      that link never renders — the opener is dropped until one is
--      attached via /admin/catalogue or install-document-templates.ts.

UPDATE "RequiredDocument" d
SET "nameEn" = 'Supplier declaration',
    "nameAr" = 'إقرار المورّد',
    "helpEn" = 'Download the template, fill it out on your Importer Header Letter, then upload the signed file. The same declaration may be reused for every product on this request.',
    "helpAr" = 'نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف موقّعاً. يمكن استخدام الإقرار نفسه لجميع منتجات هذا الطلب.'
FROM "ServiceItem" s
WHERE d."serviceItemId" = s."id"
  AND s."code" = 'SAB-001'
  AND d."code" = 'IMPORTER_DECLARATION';

UPDATE "RequiredDocument" d
SET "nameAr" = 'إقرار الصانع',
    "helpEn" = 'Download the template, fill it out on the manufacturer''s letterhead, then upload the signed file. The same declaration may be reused for every product on this request.',
    "helpAr" = 'نزّل النموذج، واملأه على الترويسة الرسمية للصانع، ثم ارفع الملف موقّعاً. يمكن استخدام الإقرار نفسه لجميع منتجات هذا الطلب.'
FROM "ServiceItem" s
WHERE d."serviceItemId" = s."id"
  AND s."code" = 'SAB-001'
  AND d."code" = 'MANUFACTURER_DECLARATION';

UPDATE "RequiredDocument" d
SET "nameEn" = 'Risk assessment form',
    "nameAr" = 'نموذج تقييم المخاطر',
    "helpEn" = 'Fill it out on your Importer Header Letter, then upload the signed file. The risk assessment is product-specific — a separate form is required for each product.',
    "helpAr" = 'املأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف موقّعاً. تقييم المخاطر خاص بكل منتج — يلزم نموذج منفصل لكل منتج.'
FROM "ServiceItem" s
WHERE d."serviceItemId" = s."id"
  AND s."code" = 'SAB-001'
  AND d."code" = 'RISK_ASSESSMENT';
