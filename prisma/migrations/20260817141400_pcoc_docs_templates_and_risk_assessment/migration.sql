-- PCOC (SAB-001) documents step fix:
--   - Importer declaration and Manufacturer declaration get "download the
--     template, fill it on your Importer Header Letter, then upload" help
--     text. The actual template files themselves are attached later via the
--     admin catalogue's per-document template upload (templateStorageKey
--     stays NULL here — this migration is text-only).
--   - Add a new mandatory "Risk assessment" required document, same
--     download/fill/upload instructions, sorted after Product label.

UPDATE "RequiredDocument"
SET "helpEn" = 'Download the template, fill it out on your Importer Header Letter, then upload the completed file.',
    "helpAr" = 'نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.'
WHERE "code" = 'IMPORTER_DECLARATION'
  AND "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SAB-001');

UPDATE "RequiredDocument"
SET "helpEn" = 'Download the template, fill it out on your Importer Header Letter, then upload the completed file.',
    "helpAr" = 'نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.'
WHERE "code" = 'MANUFACTURER_DECLARATION'
  AND "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SAB-001');

INSERT INTO "RequiredDocument" ("id", "serviceItemId", "code", "nameEn", "nameAr", "mandatory", "acceptedMimeTypes", "maxSizeMb", "helpEn", "helpAr", "sortOrder")
VALUES (
  'rd_saber_pcoc_risk_assessment',
  (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SAB-001'),
  'RISK_ASSESSMENT',
  'Risk assessment',
  'تقييم المخاطر',
  true,
  ARRAY['application/pdf']::text[],
  20,
  'Download the template, fill it out on your Importer Header Letter, then upload the completed file.',
  'نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.',
  6
)
ON CONFLICT ("serviceItemId", "code") DO NOTHING;
