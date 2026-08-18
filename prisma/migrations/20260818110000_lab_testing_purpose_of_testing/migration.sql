-- Laboratory Testing Coordination (LAB-001) form fix: the product-details
-- step must capture why the client wants the product tested (drives which
-- lab/panel gets assigned), so "purpose_of_testing" becomes a required attr.
-- Drops the unused "required_standard" attr (never asked for by clients in
-- practice) and keeps "required_tests" as an optional free-text field.
-- sortOrder is set explicitly because Postgres jsonb does not preserve
-- object key order on round-trip.

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["purpose_of_testing"],"properties":{"required_tests":{"type":"string","sortOrder":1,"titleEn":"Required tests (if specific tests are needed)","titleAr":"الاختبارات المطلوبة (إن وجدت اختبارات محددة)"},"purpose_of_testing":{"type":"string","sortOrder":2,"titleEn":"Purpose of testing","titleAr":"الغرض من الاختبار"}}}$v$::jsonb
WHERE "code" = 'LAB-001';
