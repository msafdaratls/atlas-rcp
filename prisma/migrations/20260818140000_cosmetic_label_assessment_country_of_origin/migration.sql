-- Technical Label Assessment (SFDA-COS-001): the workflow spec requires
-- country of origin alongside product name/brand (already collected via the
-- wizard's built-in RequestItem fields) and client name. Add the missing
-- required attr.

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["client_name","country_of_origin"],"properties":{"client_name":{"type":"string","sortOrder":1,"titleEn":"Client name","titleAr":"اسم العميل"},"country_of_origin":{"type":"string","sortOrder":2,"titleEn":"Country of origin","titleAr":"بلد المنشأ"}}}$v$::jsonb
WHERE "code" = 'SFDA-COS-001';
