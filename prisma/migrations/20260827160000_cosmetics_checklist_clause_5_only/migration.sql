-- GSO 1943 cosmetics checklist: clause 5 (labelling) plus rule 4.2-01.
--
-- Clause 1 (scope) is settled by product classification, clause 4 (safety:
-- composition, microbial limits, heavy metals) by the safety dossier and lab
-- data, and clause 6 (packaging & presentation) by packaging specs. None of
-- the three is answerable from label artwork, which is all the Technical
-- Label Assessment covers, so 9 of those rows are dropped from both the
-- service checklist and the KB rule set (34 rows -> 25). Rule 4.2-01 is the
-- exception and stays: it screens the printed INCI list against COSING
-- Annex II/III, which is a label-artwork check. The parser applies the same
-- exclusion to future imports (EXCLUDED_GSO_1943_CLAUSES /
-- KEPT_GSO_1943_RULE_IDS in src/server/label-eval/kb/cosmetics-parser.ts).

UPDATE "ServiceItem"
SET "checkSets" = $v$[{"code":"GSO_1943","titleEn":"GSO 1943 — Cosmetic labelling","titleAr":"GSO 1943 — بطاقة مستحضرات التجميل","items":[{"code":"RULE-GSO1943-4.2-01","titleEn":"Safety Requirements - Ingredients","titleAr":"متطلبات السلامة - المكونات","priority":"Critical"},{"code":"RULE-GSO1943-5.1-01","titleEn":"Labeling - Product Name & Trademark","titleAr":"بطاقة البيان - اسم المنتج والعلامة التجارية","priority":"Major"},{"code":"RULE-GSO1943-5.2-01","titleEn":"Labeling - Manufacturer / Distributor Name & Address","titleAr":"بطاقة البيان - اسم وعنوان الصانع/الموزع","priority":"Critical"},{"code":"RULE-GSO1943-5.3-01","titleEn":"Labeling - Country of Origin","titleAr":"بطاقة البيان - بلد المنشأ","priority":"Major"},{"code":"RULE-GSO1943-5.4-01","titleEn":"Labeling - Nominal Content","titleAr":"بطاقة البيان - المحتوى الصافي","priority":"Major"},{"code":"RULE-GSO1943-5.5-01","titleEn":"Labeling - Expiry Date & PAO","titleAr":"بطاقة البيان - تاريخ الانتهاء والفترة بعد الفتح","priority":"Critical"},{"code":"RULE-GSO1943-5.5-01A","titleEn":"Manufacturing date tracking and durability baseline calculation.","titleAr":"تتبع تاريخ التصنيع وحساب مدة الصلاحية الأساسية","priority":null},{"code":"RULE-GSO1943-5.5-01B","titleEn":"Mandatory expiry date for products with shelf life <= 30 months.","titleAr":"تاريخ انتهاء الصلاحية الإلزامي (مدة صلاحية ≤ 30 شهرًا)","priority":null},{"code":"RULE-GSO1943-5.5-01C","titleEn":"Mandatory PAO symbol for products with durability > 30 months.","titleAr":"رمز الفترة بعد الفتح الإلزامي (مدة صلاحية > 30 شهرًا)","priority":null},{"code":"RULE-GSO1943-5.5-01D","titleEn":"Exemption conditions where PAO labeling is not required.","titleAr":"شروط الإعفاء من رمز الفترة بعد الفتح","priority":null},{"code":"RULE-GSO1943-5.6-01","titleEn":"Labeling - Batch Number","titleAr":"بطاقة البيان - رقم التشغيلة","priority":"Critical"},{"code":"RULE-GSO1943-5.6-01A","titleEn":"Mandatory warnings for restricted/regulated ingredients.","titleAr":"تحذيرات إلزامية للمكونات المقيدة","priority":null},{"code":"RULE-GSO1943-5.6-01B","titleEn":"Mandatory professional use warning statements.","titleAr":"تحذيرات الاستخدام المهني","priority":null},{"code":"RULE-GSO1943-5.6-01C","titleEn":"Hand-in-book symbol exception for impracticably small packaging.","titleAr":"استثناء رمز الدليل المرفق للعبوات الصغيرة","priority":null},{"code":"RULE-GSO1943-5.7-01","titleEn":"Labeling - Particular Precautions & Warnings","titleAr":"بطاقة البيان - الاحتياطات والتحذيرات الخاصة","priority":"Critical"},{"code":"RULE-GSO1943-5.8-01","titleEn":"Labeling - Function & Directions for Use","titleAr":"بطاقة البيان - الوظيفة وطريقة الاستخدام","priority":"Major"},{"code":"RULE-GSO1943-5.8-01A","titleEn":"Product function declaration or obvious presentation exemption.","titleAr":"بيان الوظيفة، أو الإعفاء منه إذا كانت واضحة من طريقة العرض","priority":null},{"code":"RULE-GSO1943-5.9-01","titleEn":"Labeling - Ingredient Listing (INCI)","titleAr":"قائمة المكونات (INCI)","priority":"Critical"},{"code":"RULE-GSO1943-5.9-01A","titleEn":"Mandatory 'Ingredients' header preceding INCI list.","titleAr":"عنوان \"المكونات\" الإلزامي","priority":null},{"code":"RULE-GSO1943-5.9-01B","titleEn":"Fragrance/aroma declaration and mandatory allergen listing.","titleAr":"بيان العطر ومسببات الحساسية","priority":null},{"code":"RULE-GSO1943-5.9-01C","titleEn":"Descending order of concentration for ingredients > 1%.","titleAr":"الترتيب التنازلي للتركيز (> 1%)","priority":null},{"code":"RULE-GSO1943-5.9-01D","titleEn":"Mandatory '[nano]' tag for nanomaterials in INCI list.","titleAr":"علامة [nano] الإلزامية للمواد النانوية","priority":null},{"code":"RULE-GSO1943-5.9-01E","titleEn":"Colorant listing rules, CI nomenclature, and 'may contain' exception.","titleAr":"قواعد إدراج الملونات (تسمية CI)","priority":null},{"code":"RULE-GSO1943-5.9-01F","titleEn":"Mandatory use of INCI nomenclature for ingredient names.","titleAr":"الاستخدام الإلزامي لتسمية INCI","priority":null},{"code":"RULE-GSO1943-5.9-01G","titleEn":"Small package ingredient leaflet exception.","titleAr":"استثناء نشرة العبوات الصغيرة","priority":null}]}]$v$::jsonb
WHERE "code" = 'SFDA-COS-001';

-- Existing datasets: drop the excluded rules so in-flight and future
-- assessments stop rendering them. Verdicts already recorded against them go
-- too (FK is Restrict) — they are verdicts on checks that were never in
-- scope, so removing them narrows the record rather than rewriting it.
DELETE FROM "LabelItemVerdict"
WHERE "kbRuleId" IN (
  SELECT "id" FROM "LabelKbRule"
  WHERE "domain" = 'COSMETICS'
    AND "code" ~ '^RULE-GSO1943-(1\.0|4\.[0-9]|6\.[0-9])-'
    AND "code" <> 'RULE-GSO1943-4.2-01'
);

DELETE FROM "LabelKbRule"
WHERE "domain" = 'COSMETICS'
  AND "code" ~ '^RULE-GSO1943-(1\.0|4\.[0-9]|6\.[0-9])-'
  AND "code" <> 'RULE-GSO1943-4.2-01';
