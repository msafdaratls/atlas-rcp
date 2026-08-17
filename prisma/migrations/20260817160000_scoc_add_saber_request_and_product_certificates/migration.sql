-- SCOC (SAB-002) form fix: the SABER shipment-certificate workflow requires
-- (1) the SABER request number for the shipment, and (2) one PCOC product
-- certificate number per product in the shipment, each matched to the
-- model(s) it covers (a shipment can contain multiple products). Replaces
-- the old single free-text "product_certificate_number" attr with the new
-- required "saber_request_number" string attr and a required
-- "product_certificates" array-of-{certificate_number, models} attr.
-- sortOrder is set explicitly on every field because Postgres jsonb does not
-- preserve object key order on round-trip.

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["shipment_details","importer_information","saber_request_number","product_certificates"],"properties":{"shipment_details":{"type":"string","sortOrder":1,"titleEn":"Shipment details","titleAr":"تفاصيل الإرسالية"},"importer_information":{"type":"string","sortOrder":2,"titleEn":"Importer information","titleAr":"معلومات المستورد"},"saber_request_number":{"type":"string","sortOrder":3,"titleEn":"Request number in SABER","titleAr":"رقم الطلب في سابر","helpEn":"The request number for this shipment on the SABER platform.","helpAr":"رقم هذا الطلب الخاص بالإرسالية على منصة سابر."},"product_certificates":{"type":"array","sortOrder":4,"titleEn":"Product certificates (PCOC)","titleAr":"شهادات مطابقة المنتج (PCOC)","helpEn":"Add one entry per product in the shipment: its PCOC certificate number and the model(s) it covers.","helpAr":"أضف إدخالاً لكل منتج في الإرسالية: رقم شهادة مطابقة المنتج (PCOC) والموديل/الموديلات التي يغطيها.","items":{"type":"object","required":["certificate_number","models"],"properties":{"certificate_number":{"type":"string","sortOrder":1,"titleEn":"PCOC certificate number","titleAr":"رقم شهادة المطابقة"},"models":{"type":"string","sortOrder":2,"titleEn":"Model(s) covered","titleAr":"الموديل/الموديلات المشمولة"}}}}}}$v$::jsonb
WHERE "code" = 'SAB-002';
