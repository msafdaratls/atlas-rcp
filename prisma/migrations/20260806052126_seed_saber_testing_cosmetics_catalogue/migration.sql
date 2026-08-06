-- Seed SABER + Testing Coordination categories, and reconcile Cosmetics
-- against Service Catalog.docx. Idempotent (ON CONFLICT DO NOTHING) and
-- environment-agnostic, matching the style of
-- 20260725120000_seed_catalogue_categories and
-- 20260725120001_seed_catalogue_service_items.
--
-- Cosmetics reconciliation: the document defines 4 services (Technical Label
-- Assessment, Cosmetic SCOC, GHAD Product Registration, FASAH Shipment
-- Certificate Application). The 5 services seeded previously
-- (COSMETIC_LABEL_AR_EN, INCI_ANNEX_SCREEN, COSMETIC_CLAIMS_REVIEW,
-- CPSR_PIF_COMPLETE, GHAD_NOTIFICATION_READY) don't match — deactivated
-- rather than deleted so historical RequestItem rows keep a valid FK.

-- ── Main categories ─────────────────────────────────────────────────────────
INSERT INTO "MainCategory" ("id", "code", "nameEn", "nameAr", "descEn", "descAr", "icon", "sortOrder", "active") VALUES
  ('cat_saber', 'SABER', 'SABER', 'سابر',
   'Services related to the SABER platform and Saudi Technical Regulations.',
   'الخدمات المتعلقة بمنصة سابر واللوائح الفنية السعودية.',
   'shield-check', 3, true),
  ('cat_testing', 'TESTING_COORDINATION', 'Testing Coordination', 'تنسيق الاختبارات المخبرية',
   'Services related to laboratory testing and coordination with accredited laboratories.',
   'الخدمات المتعلقة بتنسيق الاختبارات مع المختبرات المعتمدة.',
   'flask-conical', 4, true)
ON CONFLICT ("code") DO NOTHING;

-- ── Sub categories: SABER ───────────────────────────────────────────────────
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active") VALUES
  ('sub_saber_pcoc', (SELECT "id" FROM "MainCategory" WHERE "code" = 'SABER'), 'PRODUCT_CERTIFICATION', 'Product Certification', 'شهادة مطابقة المنتج',
   'Product Certificate of Conformity (PCOC) issuance through the SABER platform.',
   'إصدار شهادة مطابقة المنتج (PCOC) من خلال منصة سابر.', 1, true),
  ('sub_saber_scoc', (SELECT "id" FROM "MainCategory" WHERE "code" = 'SABER'), 'SHIPMENT_CERTIFICATION', 'Shipment Certification', 'شهادة مطابقة الإرسالية',
   'Shipment Certificate of Conformity (SCOC) issuance through the SABER platform.',
   'إصدار شهادة مطابقة إرسالية من خلال منصة سابر.', 2, true),
  ('sub_saber_account_mgmt', (SELECT "id" FROM "MainCategory" WHERE "code" = 'SABER'), 'ACCOUNT_MANAGEMENT', 'Account Management', 'إدارة الحساب',
   'Ongoing management of the client''s SABER account: registration, certificate applications, and follow-up.',
   'إدارة مستمرة لحساب العميل في سابر: التسجيل وطلبات الشهادات والمتابعة.', 3, true)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;

-- ── Sub categories: Testing Coordination ────────────────────────────────────
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active") VALUES
  ('sub_lab_testing_coordination', (SELECT "id" FROM "MainCategory" WHERE "code" = 'TESTING_COORDINATION'), 'LABORATORY_TESTING_COORDINATION', 'Laboratory Testing Coordination', 'تنسيق الاختبارات المخبرية',
   'Coordination of product testing with accredited third-party laboratories.',
   'تنسيق اختبارات المنتجات مع مختبرات خارجية معتمدة.', 1, true)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;

-- ── Sub categories: Cosmetics (new — certification/registration services) ──
INSERT INTO "SubCategory" ("id", "mainCategoryId", "code", "nameEn", "nameAr", "descEn", "descAr", "sortOrder", "active") VALUES
  ('sub_cosmetic_certification', (SELECT "id" FROM "MainCategory" WHERE "code" = 'COSMETICS'), 'SFDA_CERTIFICATION', 'SFDA Certification', 'شهادات الهيئة',
   'SCOC issuance, GHAD product registration, and FASAH shipment certificate applications for cosmetics.',
   'إصدار شهادات المطابقة وتسجيل المنتجات في غد وطلبات شهادات فسح لمستحضرات التجميل.', 6, true)
ON CONFLICT ("mainCategoryId", "code") DO NOTHING;

-- ── Deactivate the 5 Cosmetics services that don't match the document ──────
UPDATE "ServiceItem" SET "active" = false
WHERE "code" IN (
  'COSMETIC_LABEL_AR_EN', 'INCI_ANNEX_SCREEN', 'COSMETIC_CLAIMS_REVIEW',
  'CPSR_PIF_COMPLETE', 'GHAD_NOTIFICATION_READY'
);

-- ── Service items: SABER PCOC ───────────────────────────────────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_saber_pcoc$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$PRODUCT_CERTIFICATION$v$),
  $v$SAB-001$v$, $v$Product Certificate of Conformity (PCOC)$v$, $v$شهادة مطابقة منتج$v$,
  $v$Issuance of a Product Certificate of Conformity (PCOC) through the SABER platform.$v$,
  $v$إصدار شهادة مطابقة منتج من خلال منصة سابر.$v$,
  2800, 0.15, 0.5, 120, 0, 3,
  $v${"type":"object","required":["product_name","product_category","hs_code","manufacturer","country_of_origin","technical_regulation"],"properties":{"product_name":{"type":"string","titleEn":"Product name","titleAr":"اسم المنتج"},"product_category":{"type":"string","titleEn":"Product category","titleAr":"فئة المنتج"},"hs_code":{"type":"string","titleEn":"HS code","titleAr":"الرمز الجمركي"},"manufacturer":{"type":"string","titleEn":"Manufacturer","titleAr":"الشركة المصنعة"},"country_of_origin":{"type":"string","titleEn":"Country of origin","titleAr":"بلد المنشأ"},"technical_regulation":{"type":"string","enum":["TEXTILE","ORNAMENTS_ACCESSORIES","PAPER_CARDBOARD","PACKAGING","MACHINERY_SAFETY","KITCHEN_TOOLS_FOOD_SAFETY","ICT_DEVICES","BUILDING_MATERIALS_PART5","BUILDING_MATERIALS_PART4","BUILDING_MATERIALS_PART1","LOW_VOLTAGE_ELECTRICAL"],"titleEn":"Technical regulation","titleAr":"اللائحة الفنية","helpEn":"Textile Products; Ornaments and Accessories; Paper and Cardboard; Packaging; General Requirements for Machinery Safety; Food Safety in Kitchen Tools and Appliances; Communications and ICT Devices; Building Materials Part 5/4/1; GCC Low Voltage Electrical Equipment and Appliances.","helpAr":"المنسوجات؛ الحلي والإكسسوارات؛ الورق والكرتون؛ التغليف؛ السلامة العامة للآلات؛ سلامة أدوات وأجهزة المطبخ؛ أجهزة الاتصالات وتقنية المعلومات؛ مواد البناء الجزء 5/4/1؛ الأجهزة الكهربائية منخفضة الجهد."}}}$v$::jsonb,
  $v$[{"code":"SABER_TECH_REG","titleEn":"Applicable technical regulation","titleAr":"اللائحة الفنية المعنية"}]$v$::jsonb,
  $v$Product Certificate of Conformity (PCOC)$v$, $v$شهادة مطابقة منتج (PCOC)$v$, 'EXTERNAL_CERTIFICATE',
  'SABER', 1, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_pcoc_importer_decl$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-001$v$), $v$IMPORTER_DECLARATION$v$, $v$Importer declaration$v$, $v$إقرار المستورد$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_pcoc_manufacturer_decl$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-001$v$), $v$MANUFACTURER_DECLARATION$v$, $v$Manufacturer declaration$v$, $v$إقرار المصنّع$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_pcoc_test_report$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-001$v$), $v$TEST_REPORT$v$, $v$Test report$v$, $v$تقرير الاختبار$v$, true, ARRAY[$v$application/pdf$v$]::text[], 50, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_pcoc_product_images$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-001$v$), $v$PRODUCT_IMAGES$v$, $v$Product images$v$, $v$صور المنتج$v$, true, ARRAY[$v$image/png$v$, $v$image/jpeg$v$]::text[], 20, NULL, NULL, 4)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_pcoc_product_label$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-001$v$), $v$PRODUCT_LABEL$v$, $v$Product label$v$, $v$بطاقة المنتج$v$, true, ARRAY[$v$application/pdf$v$, $v$image/png$v$, $v$image/jpeg$v$]::text[], 20, NULL, NULL, 5)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: SABER SCOC ───────────────────────────────────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_saber_scoc$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$SHIPMENT_CERTIFICATION$v$),
  $v$SAB-002$v$, $v$Shipment Certificate of Conformity (SCOC)$v$, $v$شهادة مطابقة إرسالية$v$,
  $v$Issuance of a Shipment Certificate of Conformity through the SABER platform.$v$,
  $v$إصدار شهادة مطابقة إرسالية من خلال منصة سابر.$v$,
  1200, 0.15, 0.5, 48, 0, 3,
  $v${"type":"object","required":["shipment_details","importer_information","product_certificate_number"],"properties":{"shipment_details":{"type":"string","titleEn":"Shipment details","titleAr":"تفاصيل الإرسالية"},"importer_information":{"type":"string","titleEn":"Importer information","titleAr":"معلومات المستورد"},"product_certificate_number":{"type":"string","titleEn":"Product certificate (PCOC) number","titleAr":"رقم شهادة مطابقة المنتج"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$Shipment Certificate of Conformity$v$, $v$شهادة مطابقة إرسالية$v$, 'EXTERNAL_CERTIFICATE',
  'SABER', 2, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_scoc_invoice$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-002$v$), $v$COMMERCIAL_INVOICE$v$, $v$Commercial invoice$v$, $v$الفاتورة التجارية$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_scoc_packing_list$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-002$v$), $v$PACKING_LIST$v$, $v$Packing list$v$, $v$قائمة التعبئة$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_scoc_pcoc$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-002$v$), $v$PRODUCT_CERTIFICATE$v$, $v$Product certificate (PCOC)$v$, $v$شهادة مطابقة المنتج$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: SABER Account Management ─────────────────────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_saber_account_mgmt$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$ACCOUNT_MANAGEMENT$v$),
  $v$SAB-003$v$, $v$SABER Account Management$v$, $v$إدارة حساب سابر$v$,
  $v$Complete management of the customer's SABER account, including technical file preparation, product registration, submission of Product and Shipment Certificate applications, and follow-up until completion.$v$,
  $v$إدارة حساب العميل في منصة سابر، وتشمل تجهيز الملف الفني، وتسجيل المنتجات، ورفع طلبات شهادات مطابقة المنتجات والإرساليات، ومتابعة جميع الطلبات حتى اكتمالها.$v$,
  6000, 0.15, 0.5, 720, 0, 3,
  $v${"type":"object","required":["saber_login_email","company_name","cr_number"],"properties":{"saber_login_email":{"type":"string","titleEn":"SABER login email","titleAr":"البريد الإلكتروني لحساب سابر"},"company_name":{"type":"string","titleEn":"Company name","titleAr":"اسم الشركة"},"cr_number":{"type":"string","titleEn":"Commercial registration number","titleAr":"رقم السجل التجاري"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$Completed Requested Service$v$, $v$إنجاز الخدمة المطلوبة$v$, 'INTERNAL_REPORT',
  'SABER', 3, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_saber_account_mgmt_product_info$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SAB-003$v$), $v$PRODUCT_INFORMATION$v$, $v$Product information$v$, $v$معلومات المنتج$v$, true, ARRAY[$v$application/pdf$v$, $v$application/vnd.openxmlformats-officedocument.spreadsheetml.sheet$v$]::text[], 50, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: Laboratory Testing Coordination ──────────────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_lab_testing_coordination$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$LABORATORY_TESTING_COORDINATION$v$),
  $v$LAB-001$v$, $v$Laboratory Testing Coordination$v$, $v$تنسيق الاختبارات المخبرية$v$,
  $v$Management and coordination of laboratory testing with accredited laboratories.$v$,
  $v$إدارة وتنسيق الاختبارات المخبرية مع المختبرات المعتمدة.$v$,
  800, 0.15, 0.5, 168, 0, 3,
  $v${"type":"object","required":["product_name"],"properties":{"product_name":{"type":"string","titleEn":"Product name","titleAr":"اسم المنتج"},"required_standard":{"type":"string","titleEn":"Required standard (if known)","titleAr":"المواصفة المطلوبة (إن وجدت)"},"required_tests":{"type":"string","titleEn":"Required tests (if specific tests are needed)","titleAr":"الاختبارات المطلوبة (إن وجدت اختبارات محددة)"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$Laboratory Test Report$v$, $v$تقرير الاختبار المخبري$v$, 'EXTERNAL_CERTIFICATE',
  NULL, 1, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_lab_testing_spec$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$LAB-001$v$), $v$PRODUCT_SPECIFICATION$v$, $v$Product specification (if available)$v$, $v$مواصفات المنتج (إن وجدت)$v$, false, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_lab_testing_images$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$LAB-001$v$), $v$PRODUCT_IMAGES$v$, $v$Product images$v$, $v$صور المنتج$v$, true, ARRAY[$v$image/png$v$, $v$image/jpeg$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_lab_testing_datasheet$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$LAB-001$v$), $v$TECHNICAL_DATASHEET$v$, $v$Technical datasheet (if available)$v$, $v$النشرة الفنية (إن وجدت)$v$, false, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: Cosmetics — Technical Label Assessment ───────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_sfda_cos_001_label_assessment$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$COSMETIC_LABELLING$v$),
  $v$SFDA-COS-001$v$, $v$Technical Label Assessment$v$, $v$التقييم الفني لملصق المنتج$v$,
  $v$Technical assessment of cosmetic product labeling to verify compliance with SFDA regulations and applicable Gulf standards.$v$,
  $v$تقييم فني لملصق المنتج التجميلي للتحقق من مطابقته لمتطلبات الهيئة العامة للغذاء والدواء والمواصفات الخليجية.$v$,
  1500, 0.15, 0.5, 72, 0, 3,
  $v${"type":"object","required":["product_name","brand_name","client_name"],"properties":{"product_name":{"type":"string","titleEn":"Product name","titleAr":"اسم المنتج"},"brand_name":{"type":"string","titleEn":"Brand name","titleAr":"اسم العلامة التجارية"},"client_name":{"type":"string","titleEn":"Client name","titleAr":"اسم العميل"}}}$v$::jsonb,
  $v$[{"code":"GSO_1943","titleEn":"GSO 1943 — Cosmetic labelling","titleAr":"GSO 1943 — بطاقة مستحضرات التجميل"}]$v$::jsonb,
  $v$Technical Label Assessment Report$v$, $v$تقرير التقييم الفني للملصق$v$, 'INTERNAL_REPORT',
  NULL, 2, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_001_artwork$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-001$v$), $v$PRODUCT_ARTWORK$v$, $v$Product artwork$v$, $v$تصميم المنتج$v$, true, ARRAY[$v$application/pdf$v$, $v$image/png$v$, $v$image/jpeg$v$]::text[], 50, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_001_inci$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-001$v$), $v$INGREDIENT_LIST_INCI$v$, $v$Ingredient list (INCI)$v$, $v$قائمة المكونات (INCI)$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: Cosmetics — Shipment Certificate of Conformity (SCOC) ───
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_sfda_cos_002_scoc$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$SFDA_CERTIFICATION$v$),
  $v$SFDA-COS-002$v$, $v$Cosmetic Shipment Certificate of Conformity (SCOC)$v$, $v$شهادة مطابقة إرسالية لمستحضرات التجميل$v$,
  $v$Issuance of a Shipment Certificate of Conformity (SCOC) after completing the conformity assessment process.$v$,
  $v$إصدار شهادة مطابقة إرسالية لمستحضرات التجميل بعد استكمال إجراءات تقييم المطابقة.$v$,
  1200, 0.15, 0.5, 48, 0, 3,
  $v${"type":"object","required":["faseh_request_no","importer","country_of_origin"],"properties":{"faseh_request_no":{"type":"string","titleEn":"FASEH request #","titleAr":"رقم طلب فسح"},"importer":{"type":"string","titleEn":"Importer","titleAr":"المستورد"},"country_of_origin":{"type":"string","titleEn":"Country of origin","titleAr":"بلد المنشأ"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$Shipment Certificate of Conformity (SCOC)$v$, $v$شهادة مطابقة إرسالية$v$, 'EXTERNAL_CERTIFICATE',
  NULL, 1, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_002_artwork$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-002$v$), $v$PRODUCT_ARTWORK$v$, $v$Product artwork$v$, $v$تصميم المنتج$v$, true, ARRAY[$v$application/pdf$v$, $v$image/png$v$, $v$image/jpeg$v$]::text[], 50, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_002_ingredients$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-002$v$), $v$INGREDIENT_LIST$v$, $v$Ingredient list$v$, $v$قائمة المكونات$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_002_invoice_batch$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-002$v$), $v$COMMERCIAL_INVOICE_BATCH$v$, $v$Commercial invoice with batch number$v$, $v$الفاتورة التجارية مع رقم الدفعة$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_002_packing_list$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-002$v$), $v$PACKING_LIST$v$, $v$Packing list$v$, $v$قائمة التعبئة$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 4)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: Cosmetics — GHAD Product Registration ───────────────────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_sfda_cos_003_ghad_registration$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$SFDA_CERTIFICATION$v$),
  $v$SFDA-COS-003$v$, $v$GHAD Product Registration$v$, $v$تسجيل المنتجات في نظام غد$v$,
  $v$Registration of cosmetic products in the SFDA GHAD system and follow-up until approval.$v$,
  $v$تسجيل المنتجات التجميلية في نظام غد ومتابعة الطلب حتى اكتمال إجراءات التسجيل.$v$,
  2000, 0.15, 0.5, 240, 0, 3,
  $v${"type":"object","required":["client_name"],"properties":{"client_name":{"type":"string","titleEn":"Client name","titleAr":"اسم العميل"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$Certificate for Cosmetic Product Notification$v$, $v$شهادة إخطار المنتج التجميلي$v$, 'EXTERNAL_CERTIFICATE',
  'GHAD', 2, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_003_artwork$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-003$v$), $v$PRODUCT_ARTWORK$v$, $v$Product artwork$v$, $v$تصميم المنتج$v$, true, ARRAY[$v$application/pdf$v$, $v$image/png$v$, $v$image/jpeg$v$]::text[], 50, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_003_ingredients$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-003$v$), $v$INGREDIENT_LIST$v$, $v$Ingredient list$v$, $v$قائمة المكونات$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_003_images$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-003$v$), $v$PRODUCT_IMAGES$v$, $v$Product images$v$, $v$صور المنتج$v$, true, ARRAY[$v$image/png$v$, $v$image/jpeg$v$]::text[], 20, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_003_auth_letter$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-003$v$), $v$AUTHORIZATION_LETTER$v$, $v$Authorization letter$v$, $v$خطاب تفويض$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 4)
ON CONFLICT ("serviceItemId","code") DO NOTHING;

-- ── Service items: Cosmetics — FASAH Shipment Certificate Application ──────
INSERT INTO "ServiceItem" (
  "id","subCategoryId","code","nameEn","nameAr","descEn","descAr",
  "basePrice","vatRate","resubmissionPricePct","slaHours","freeResubmissions","maxResubmissions",
  "productAttrSchema","checkSets","deliverableEn","deliverableAr","deliverableType",
  "requiredCredentialPlatform","sortOrder","active"
) VALUES (
  $v$svc_sfda_cos_004_fasah_cert$v$,
  (SELECT "id" FROM "SubCategory" WHERE "code" = $v$SFDA_CERTIFICATION$v$),
  $v$SFDA-COS-004$v$, $v$FASAH Shipment Certificate Application$v$, $v$رفع طلب شهادة المطابقة عبر منصة فسح$v$,
  $v$Submission and follow-up of cosmetic shipment certificate applications through the FASAH platform.$v$,
  $v$رفع ومتابعة طلب شهادة مطابقة الإرسالية عبر منصة فسح.$v$,
  1000, 0.15, 0.5, 48, 0, 3,
  $v${"type":"object","required":["product_notification_number","importer_information","port_of_entry"],"properties":{"product_notification_number":{"type":"string","titleEn":"Product notification number","titleAr":"رقم إخطار المنتج"},"importer_information":{"type":"string","titleEn":"Importer information","titleAr":"معلومات المستورد"},"port_of_entry":{"type":"string","titleEn":"Port of entry","titleAr":"منفذ الدخول"}}}$v$::jsonb,
  $v$[]$v$::jsonb,
  $v$FASEH Request #$v$, $v$رقم طلب فسح$v$, 'EXTERNAL_CERTIFICATE',
  'GHAD', 3, true
) ON CONFLICT ("subCategoryId","code") DO NOTHING;

INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_004_invoice$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-004$v$), $v$COMMERCIAL_INVOICE$v$, $v$Commercial invoice$v$, $v$الفاتورة التجارية$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 1)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_004_packing_list$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-004$v$), $v$PACKING_LIST$v$, $v$Packing list$v$, $v$قائمة التعبئة$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 2)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
INSERT INTO "RequiredDocument" ("id","serviceItemId","code","nameEn","nameAr","mandatory","acceptedMimeTypes","maxSizeMb","helpEn","helpAr","sortOrder") VALUES
  ($v$rd_sfda_cos_004_bol_awb$v$, (SELECT "id" FROM "ServiceItem" WHERE "code" = $v$SFDA-COS-004$v$), $v$BILL_OF_LADING_AWB$v$, $v$Bill of lading / air waybill$v$, $v$بوليصة الشحن / بوليصة الشحن الجوي$v$, true, ARRAY[$v$application/pdf$v$]::text[], 20, NULL, NULL, 3)
ON CONFLICT ("serviceItemId","code") DO NOTHING;
