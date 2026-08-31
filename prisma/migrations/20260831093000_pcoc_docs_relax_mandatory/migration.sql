-- PCOC (SAB-001) document tab fix: only "Product images" and "Product label"
-- remain mandatory; supplier declaration, manufacturer declaration, test
-- report, and risk assessment form are relaxed to optional. Additional
-- documents was already optional and is untouched.

UPDATE "RequiredDocument"
SET "mandatory" = false
WHERE "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SAB-001')
  AND "code" IN ('IMPORTER_DECLARATION', 'MANUFACTURER_DECLARATION', 'TEST_REPORT', 'RISK_ASSESSMENT');
