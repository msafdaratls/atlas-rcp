-- Explicit opt-in list of which ServiceItems the Label Evaluator applies to
-- (design doc §2A, §3 — LabelEvalServiceMapping). NOT a code/name pattern
-- match: only the three services below are label-assessment work. The other
-- Cosmetics services under the same MainCategory (SFDA-COS-002 Shipment
-- Certificate of Conformity, SFDA-COS-003 GHAD Product Registration,
-- SFDA-COS-004 FASAH Shipment Certificate Application) are deliberately
-- NOT mapped — they are external-portal/certificate work, not label review,
-- and must never appear in the evaluation queue.
--
-- Idempotent (ON CONFLICT DO NOTHING), same style as
-- 20260806052126_seed_saber_testing_cosmetics_catalogue. Safe to no-op if a
-- code doesn't exist yet in a given environment's catalogue.

INSERT INTO "LabelEvalServiceMapping" ("id", "serviceItemId", "domain")
SELECT 'label_map_sfda_full', "id", 'SFDA_SUPPLEMENTS'
FROM "ServiceItem" WHERE "code" = 'SUPPLEMENT_LABEL_FULL'
ON CONFLICT ("serviceItemId") DO NOTHING;

INSERT INTO "LabelEvalServiceMapping" ("id", "serviceItemId", "domain")
SELECT 'label_map_sfda_rereview', "id", 'SFDA_SUPPLEMENTS'
FROM "ServiceItem" WHERE "code" = 'SUPPLEMENT_LABEL_REREVIEW'
ON CONFLICT ("serviceItemId") DO NOTHING;

INSERT INTO "LabelEvalServiceMapping" ("id", "serviceItemId", "domain")
SELECT 'label_map_cos_001', "id", 'COSMETICS'
FROM "ServiceItem" WHERE "code" = 'SFDA-COS-001'
ON CONFLICT ("serviceItemId") DO NOTHING;
