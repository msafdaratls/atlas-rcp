-- GHAD Product Registration (SFDA-COS-003) document/attr fix:
--   - Drop the "Product images" required document — not part of the
--     workflow spec's document list (artwork, ingredient list, letter of
--     authorization). ON DELETE SET NULL on RequestDocument.requiredDocumentId
--     means any already-uploaded files on past requests are preserved, just
--     detached from the (now-removed) requirement.
--   - Add a repeatable "products" attr so one request can register multiple
--     products in the same GHAD batch (mirrors SAB-002's product_certificates
--     array pattern from migration 20260817160000).

DELETE FROM "RequiredDocument"
WHERE "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SFDA-COS-003')
  AND "code" = 'PRODUCT_IMAGES';

UPDATE "RequiredDocument"
SET "sortOrder" = 3
WHERE "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SFDA-COS-003')
  AND "code" = 'AUTHORIZATION_LETTER';

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["client_name","products"],"properties":{"client_name":{"type":"string","sortOrder":1,"titleEn":"Client name","titleAr":"اسم العميل"},"products":{"type":"array","sortOrder":2,"titleEn":"Products","titleAr":"المنتجات","helpEn":"Add one entry per product to register in this batch.","helpAr":"أضف إدخالاً لكل منتج سيتم تسجيله ضمن هذه الدفعة.","items":{"type":"object","required":["product_name"],"properties":{"product_name":{"type":"string","sortOrder":1,"titleEn":"Product name","titleAr":"اسم المنتج"}}}}}}$v$::jsonb
WHERE "code" = 'SFDA-COS-003';
