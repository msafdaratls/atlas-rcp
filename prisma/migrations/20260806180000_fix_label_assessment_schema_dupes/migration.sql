-- SFDA-COS-001's productAttrSchema duplicated the wizard's built-in
-- productNameEn/productNameAr and brand fields via product_name/brand_name,
-- forcing customers to enter the same data twice. Drop the duplicates,
-- keeping client_name which the base wizard doesn't collect.
UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["client_name"],"properties":{"client_name":{"type":"string","titleEn":"Client name","titleAr":"اسم العميل"}}}$v$::jsonb
WHERE "code" = $v$SFDA-COS-001$v$;
