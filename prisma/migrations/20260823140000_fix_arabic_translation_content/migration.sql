-- Bring the Arabic translation fixes from prisma/seed.ts and
-- prisma/seed-assets/sfda-checksets.ts into already-seeded rows.
--
-- Those two files are only read by `db:seed` (never run in prod — prod's
-- catalogue/checklist content came from earlier one-time data migrations
-- that each embedded their own literal copy of the same text). Editing the
-- source files alone does not change already-applied rows, so this
-- migration replicates the same corrections directly against the live
-- data, scoped by exact full-string match so it can only touch the exact
-- values being fixed (verified against a snapshot of the current prod/dev
-- data before writing this).
--
-- NOTE on spacing: Postgres re-serializes `jsonb` in its own canonical
-- form (`"key": "value"`, space after the colon and after each comma) —
-- NOT the original compact JSON text the seed migrations wrote. Every
-- pattern below matches that canonical form, verified directly against a
-- live `jsonb::text` dump before writing this, not against the source
-- migration files' literal text.
--
-- Full-column fixes (ملصق -> بطاقة, the correct GSO/SASO term for a
-- regulated product label, vs. "ملصق" which just means "sticker"):
UPDATE "ServiceItem"
SET "nameAr" = 'التقييم الفني لبطاقة المنتج'
WHERE "nameAr" = 'التقييم الفني لملصق المنتج';

UPDATE "ServiceItem"
SET "descAr" = 'تقييم فني لبطاقة المنتج التجميلي للتحقق من مطابقته لمتطلبات الهيئة العامة للغذاء والدواء والمواصفات الخليجية.'
WHERE "descAr" = 'تقييم فني لملصق المنتج التجميلي للتحقق من مطابقته لمتطلبات الهيئة العامة للغذاء والدواء والمواصفات الخليجية.';

UPDATE "ServiceItem"
SET "deliverableAr" = 'تقرير التقييم الفني للبطاقة'
WHERE "deliverableAr" = 'تقرير التقييم الفني للملصق';

-- checkSets (jsonb) fixes: each replace() targets the exact
-- `"titleAr": "<full value>"` pair (canonical jsonb spacing) so a
-- partial/loose substring can never touch a different, unrelated
-- checklist item that happens to share a few words (confirmed distinct
-- from e.g. FD_2233_01's similarly-worded but different "متطلبات البطاقة
-- الغذائية" question, deliberately left untouched here since it was not
-- part of the verified fix set).

-- Cosmetics GSO 1943 checkset: missing "بطاقة البيان -" section prefix,
-- and a dropped "in both languages" requirement.
UPDATE "ServiceItem"
SET "checkSets" = replace(
  replace(
    "checkSets"::text,
    '"titleAr": "قائمة المكونات (INCI)"',
    '"titleAr": "بطاقة البيان - قائمة المكونات (INCI)"'
  ),
  '"titleAr": "تحذيرات إلزامية للأمبولات والقوارير الزجاجية"',
  '"titleAr": "تحذيرات إلزامية للأمبولات والقوارير الزجاجية باللغتين العربية والإنجليزية"'
)::jsonb
WHERE "checkSets"::text LIKE '%قائمة المكونات (INCI)%'
   OR "checkSets"::text LIKE '%تحذيرات إلزامية للأمبولات والقوارير الزجاجية"%';

-- Cosmetics claims checkset: wrong count ("five" where the English list
-- names six purposes).
UPDATE "ServiceItem"
SET "checkSets" = replace(
  "checkSets"::text,
  '"titleAr": "هل الوظيفة تقتصر على الأغراض التجميلية الخمسة؟"',
  '"titleAr": "هل الوظيفة تقتصر على الأغراض التجميلية الستة (التنظيف، التعطير، تغيير المظهر، الحماية، الحفاظ على حالة جيدة، تصحيح رائحة الجسم)؟"'
)::jsonb
WHERE "checkSets"::text LIKE '%الأغراض التجميلية الخمسة؟%';

-- SFDA 113-item supplement checklist: ملصق -> بطاقة, SFDA spelled out ->
-- kept as the Latin acronym (matches every other reference in the file),
-- غذائي/تغذوي claim-term drift between a question and its own guidance
-- text (6 items), a spelling variant (بالجرام -> بالغرام), and a unit
-- notation inconsistency (mg/µg/IU/g/mL kept in Latin, matching this
-- item's own knowledge-base field). This content is duplicated across
-- every Food & Drugs service item it's attached to, so this intentionally
-- applies across all rows rather than one service code.
UPDATE "ServiceItem"
SET "checkSets" = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
  "checkSets"::text,
  '"titleAr": "هل تم بيان الشكل الجرعي / طريقة التناول بوضوح على الملصق؟"',
  '"titleAr": "هل تم بيان الشكل الجرعي / طريقة التناول بوضوح على البطاقة؟"'),
  '"titleAr": "هل تمتثل لغة الملصق لمتطلبات الهيئة العامة للغذاء والدواء؟"',
  '"titleAr": "هل تمتثل لغة البطاقة لمتطلبات SFDA؟"'),
  '"titleAr": "في حال وجود ادّعاء غذائي، هل تم الإفصاح عن المُغذّي ذي الصلة؟"',
  '"titleAr": "في حال وجود ادّعاء تغذوي، هل تم الإفصاح عن المُغذّي ذي الصلة؟"'),
  '"titleAr": "عند وجود ادّعاء غذائي أو صحي، هل تم الإفصاح عن المُغذّيات ذات الصلة؟"',
  '"titleAr": "عند وجود ادّعاء تغذوي أو صحي، هل تم الإفصاح عن المُغذّيات ذات الصلة؟"'),
  '"titleAr": "هل يحتوي المنتج على ادّعاء صحي أو غذائي؟"',
  '"titleAr": "هل يحتوي المنتج على ادّعاء صحي أو تغذوي؟"'),
  '"titleAr": "هل تُطبّق متطلبات البطاقة الغذائية عند استخدام الادّعاءات؟"',
  '"titleAr": "هل تُطبّق متطلبات البطاقة التغذوية عند استخدام الادّعاءات؟"'),
  '"titleAr": "في حال استخدام ادّعاء غذائي، هل هو مدرج في الجدول (2)؟"',
  '"titleAr": "في حال استخدام ادّعاء تغذوي، هل هو مدرج في الجدول (2)؟"'),
  '"titleAr": "في حال استخدام ادّعاء غذائي، هل تم استيفاء جميع شروط الاستخدام؟"',
  '"titleAr": "في حال استخدام ادّعاء تغذوي، هل تم استيفاء جميع شروط الاستخدام؟"'),
  '"titleAr": "هل يُعبّر عن البروتين والكربوهيدرات والدهون بالجرام؟"',
  '"titleAr": "هل يُعبّر عن البروتين والكربوهيدرات والدهون بالغرام؟"'),
  '"titleAr": "هل وحدات قياس المكوّنات صحيحة (ملغ، ميكروغرام، IU، غ، مل، إلخ)؟"',
  '"titleAr": "هل وحدات قياس المكوّنات صحيحة (mg، µg، IU، g، mL، إلخ)؟"'
)::jsonb
WHERE "checkSets"::text LIKE '%على الملصق؟%'
   OR "checkSets"::text LIKE '%لغة الملصق لمتطلبات%'
   OR "checkSets"::text LIKE '%ادّعاء غذائي%'
   OR "checkSets"::text LIKE '%البطاقة الغذائية عند استخدام%'
   OR "checkSets"::text LIKE '%بالجرام؟%'
   OR "checkSets"::text LIKE '%ملغ، ميكروغرام%';
