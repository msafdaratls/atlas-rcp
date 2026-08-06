-- SAB-001 (PCOC) and LAB-001 (Laboratory Testing Coordination) duplicated
-- "product_name" as a productAttrSchema field, but RequestItem already has
-- dedicated productNameEn/productNameAr columns collected in the same wizard
-- step — drop the redundant attr rather than asking for the same value twice.

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["product_category","hs_code","manufacturer","country_of_origin","technical_regulation"],"properties":{"product_category":{"type":"string","titleEn":"Product category","titleAr":"فئة المنتج"},"hs_code":{"type":"string","titleEn":"HS code","titleAr":"الرمز الجمركي"},"manufacturer":{"type":"string","titleEn":"Manufacturer","titleAr":"الشركة المصنعة"},"country_of_origin":{"type":"string","titleEn":"Country of origin","titleAr":"بلد المنشأ"},"technical_regulation":{"type":"string","enum":["TEXTILE","ORNAMENTS_ACCESSORIES","PAPER_CARDBOARD","PACKAGING","MACHINERY_SAFETY","KITCHEN_TOOLS_FOOD_SAFETY","ICT_DEVICES","BUILDING_MATERIALS_PART5","BUILDING_MATERIALS_PART4","BUILDING_MATERIALS_PART1","LOW_VOLTAGE_ELECTRICAL"],"titleEn":"Technical regulation","titleAr":"اللائحة الفنية","helpEn":"Textile Products; Ornaments and Accessories; Paper and Cardboard; Packaging; General Requirements for Machinery Safety; Food Safety in Kitchen Tools and Appliances; Communications and ICT Devices; Building Materials Part 5/4/1; GCC Low Voltage Electrical Equipment and Appliances.","helpAr":"المنسوجات؛ الحلي والإكسسوارات؛ الورق والكرتون؛ التغليف؛ السلامة العامة للآلات؛ سلامة أدوات وأجهزة المطبخ؛ أجهزة الاتصالات وتقنية المعلومات؛ مواد البناء الجزء 5/4/1؛ الأجهزة الكهربائية منخفضة الجهد."}}}$v$::jsonb
WHERE "code" = 'SAB-001';

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":[],"properties":{"required_standard":{"type":"string","titleEn":"Required standard (if known)","titleAr":"المواصفة المطلوبة (إن وجدت)"},"required_tests":{"type":"string","titleEn":"Required tests (if specific tests are needed)","titleAr":"الاختبارات المطلوبة (إن وجدت اختبارات محددة)"}}}$v$::jsonb
WHERE "code" = 'LAB-001';
