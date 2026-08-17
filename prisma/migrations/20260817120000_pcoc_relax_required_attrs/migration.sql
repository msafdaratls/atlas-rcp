-- PCOC (SAB-001) form fix: drop the redundant "product_category" attr (the
-- mandatory PRODUCT_IMAGES document already covers it), relax hs_code,
-- manufacturer and technical_regulation from required to optional (only
-- country_of_origin stays mandatory), and add the optional
-- saber_request_number attr for clients who already started their request
-- on the SABER platform themselves.

UPDATE "ServiceItem"
SET "productAttrSchema" = $v${"type":"object","required":["country_of_origin"],"properties":{"hs_code":{"type":"string","titleEn":"HS code","titleAr":"الرمز الجمركي"},"manufacturer":{"type":"string","titleEn":"Manufacturer","titleAr":"الشركة المصنعة"},"country_of_origin":{"type":"string","titleEn":"Country of origin","titleAr":"بلد المنشأ"},"technical_regulation":{"type":"string","enum":["TEXTILE","ORNAMENTS_ACCESSORIES","PAPER_CARDBOARD","PACKAGING","MACHINERY_SAFETY","KITCHEN_TOOLS_FOOD_SAFETY","ICT_DEVICES","BUILDING_MATERIALS_PART5","BUILDING_MATERIALS_PART4","BUILDING_MATERIALS_PART1","LOW_VOLTAGE_ELECTRICAL"],"titleEn":"Technical regulation","titleAr":"اللائحة الفنية","helpEn":"Textile Products; Ornaments and Accessories; Paper and Cardboard; Packaging; General Requirements for Machinery Safety; Food Safety in Kitchen Tools and Appliances; Communications and ICT Devices; Building Materials Part 5/4/1; GCC Low Voltage Electrical Equipment and Appliances.","helpAr":"المنسوجات؛ الحلي والإكسسوارات؛ الورق والكرتون؛ التغليف؛ السلامة العامة للآلات؛ سلامة أدوات وأجهزة المطبخ؛ أجهزة الاتصالات وتقنية المعلومات؛ مواد البناء الجزء 5/4/1؛ الأجهزة الكهربائية منخفضة الجهد."},"saber_request_number":{"type":"string","titleEn":"SABER request number","titleAr":"رقم طلب سابر","helpEn":"If you already started this request on the SABER platform, enter its request number.","helpAr":"إذا كنت قد بدأت هذا الطلب بالفعل على منصة سابر، فأدخل رقم الطلب."}}}$v$::jsonb
WHERE "code" = 'SAB-001';
