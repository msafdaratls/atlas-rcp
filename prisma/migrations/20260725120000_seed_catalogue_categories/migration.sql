-- Seed the request catalogue taxonomy (main + sub categories) so clients can
-- file requests. Idempotent and environment-agnostic:
--   * ON CONFLICT DO NOTHING makes re-runs a no-op.
--   * Sub categories resolve their parent by CODE via a subquery, so this works
--     whether the parent was just inserted here (empty prod DB) or already
--     exists under a different id (a dev DB that was seeded by prisma/seed.ts).

-- ── Main categories ─────────────────────────────────────────────────────────
INSERT INTO "MainCategory" ("id", "code", "nameEn", "nameAr", "descEn", "descAr", "icon", "sortOrder", "active") VALUES
  ('cat_food_drugs', 'FOOD_DRUGS', 'Food & Drugs', 'الغذاء والدواء',
   'Conformity assessment services against SFDA food, supplements, claims, and additives requirements.',
   'خدمات تقييم المطابقة وفق متطلبات الهيئة العامة للغذاء والدواء للأغذية والمكملات والادعاءات والمواد المضافة.',
   'pill', 1, true),
  ('cat_cosmetics', 'COSMETICS', 'Cosmetics', 'مستحضرات التجميل',
   'Labelling, ingredient annex screening, claims, and dossier readiness for cosmetic products.',
   'تقييم بطاقات ومستندات مستحضرات التجميل وفحص المكونات والادعاءات وجاهزية الملفات.',
   'sparkles', 2, true)
ON CONFLICT ("code") DO NOTHING;

-- ── Sub categories: Food & Drugs ────────────────────────────────────────────
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active") VALUES
  ('sub_food_supplements', (SELECT "id" FROM "MainCategory" WHERE "code" = 'FOOD_DRUGS'), 'FOOD_SUPPLEMENTS', 'Food Supplements', 'المكملات الغذائية',
   'Label and dossier assessment for food supplements under FD 55 and related SFDA rules.',
   'تقييم بطاقات وملفات المكملات الغذائية وفق اللائحة FD 55 والمتطلبات ذات الصلة.', 1, true),
  ('sub_general_food_labelling', (SELECT "id" FROM "MainCategory" WHERE "code" = 'FOOD_DRUGS'), 'GENERAL_FOOD_LABELLING', 'General Food Labelling', 'بطاقة البيان العامة للأغذية',
   'Packaged food label assessment against GSO 9 / SFDA FD GSO 9.',
   'تقييم بطاقة الأغذية المعبأة وفق المواصفة GSO 9 / SFDA FD GSO 9.', 2, true),
  ('sub_nutrition_labelling', (SELECT "id" FROM "MainCategory" WHERE "code" = 'FOOD_DRUGS'), 'NUTRITION_LABELLING', 'Nutrition Labelling', 'بطاقة التغذية',
   'Nutrition facts panel verification against SFDA FD 2233.',
   'التحقق من لوحة الحقائق الغذائية وفق SFDA FD 2233.', 3, true),
  ('sub_health_nutrition_claims', (SELECT "id" FROM "MainCategory" WHERE "code" = 'FOOD_DRUGS'), 'HEALTH_NUTRITION_CLAIMS', 'Health & Nutrition Claims', 'الادعاءات الصحية والتغذوية',
   'Claims substantiation review against SFDA FD 2333 and permitted claims tables.',
   'مراجعة إثبات الادعاءات وفق SFDA FD 2333 وجداول الادعاءات المسموح بها.', 4, true),
  ('sub_food_additives', (SELECT "id" FROM "MainCategory" WHERE "code" = 'FOOD_DRUGS'), 'FOOD_ADDITIVES', 'Food Additives', 'المواد المضافة للأغذية',
   'Formulation additive screening against SFDA FD 2500 and GMP lists.',
   'فحص المواد المضافة في التركيبة وفق SFDA FD 2500 وقوائم GMP.', 5, true)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;

-- ── Sub categories: Cosmetics ───────────────────────────────────────────────
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active") VALUES
  ('sub_cosmetic_labelling', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'COSMETIC_LABELLING', 'Cosmetic Labelling', 'بطاقة مستحضرات التجميل',
   'Arabic/English cosmetic label assessment against GSO 1943 labelling articles.',
   'تقييم بطاقة مستحضر التجميل بالعربية والإنجليزية وفق مواد GSO 1943.', 1, true),
  ('sub_ingredient_screening', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'INGREDIENT_SCREENING', 'Ingredient Screening', 'فحص المكونات',
   'INCI screening against prohibited, restricted, colorant, preservative, and UV-filter annexes.',
   'فحص أسماء INCI مقابل ملاحق المحظور والمقيد والملونات والمواد الحافظة ومرشحات الأشعة فوق البنفسجية.', 2, true),
  ('sub_product_claims', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'PRODUCT_CLAIMS', 'Product Claims', 'ادعاءات المنتج',
   'Cosmetic claims review against GSO claims rules and SFDA guidance.',
   'مراجعة ادعاءات مستحضرات التجميل وفق قواعد GSO وإرشادات الهيئة.', 3, true),
  ('sub_safety_documentation', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'SAFETY_DOCUMENTATION', 'Safety Documentation', 'وثائق السلامة',
   'CPSR / PIF completeness review against GSO 1943 and PIF checklists.',
   'مراجعة اكتمال تقرير سلامة المنتج وملف معلومات المنتج وفق GSO 1943 وقوائم التحقق.', 4, true),
  ('sub_notification_dossier', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'NOTIFICATION_DOSSIER', 'Notification Dossier', 'ملف الإخطار',
   'SFDA GHAD notification readiness checklist review.',
   'مراجعة جاهزية ملف الإخطار عبر منصة غد التابعة للهيئة.', 5, true)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;
