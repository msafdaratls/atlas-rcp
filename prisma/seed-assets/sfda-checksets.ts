// AUTO-GENERATED from the SFDA "Food Supplement Label Assessment" workbook.
// 5 regulatory sections, 113 verification items total (19 + 24 + 37 + 14 + 19).
// Each item carries the SFDA knowledge base and reviewer guidance so the
// "what we check" flow can show evidence, compliant-when wording, common
// non-conformities and priority per item. Section-level shape — no schema change.

export interface SfdaCheckItem {
  code: string;
  titleEn: string;
  titleAr: string;
  priority?: string;                 // Critical | High | Medium | Low
  category?: string;
  knowledgeBaseEn?: string;
  knowledgeBaseAr?: string;
  evidenceRequired?: string;
  compliantWhen?: string;
  commonNonConformities?: string;
  referenceRange?: string;           // FD 2333 / FD 2500 lookup ranges
  applicability?: string;
  decisionRule?: string;
}

export interface SfdaCheckSet {
  code: string;
  titleEn: string;
  titleAr: string;
  standard: string;
  itemCount: number;
  items: SfdaCheckItem[];
}

export const foodCheckSets: SfdaCheckSet[] = [
  {
    "code": "GSO_9",
    "titleEn": "General Labeling (GSO 9)",
    "titleAr": "البطاقات الغذائية العامة (GSO 9)",
    "standard": "SFDA FD. GSO 9",
    "itemCount": 19,
    "items": [
      {
        "code": "GSO_9_01",
        "titleEn": "Is the product name present?",
        "titleAr": "هل اسم المنتج موجود؟",
        "priority": "Critical",
        "category": "Product Identity",
        "knowledgeBaseEn": "Product Name: The name that identifies the food product and distinguishes it from other products. It shall appear on the principal display panel.",
        "knowledgeBaseAr": "اسم المنتج: الاسم الذي يعرّف المنتج الغذائي ويميزه عن المنتجات الأخرى. ويجب أن يظهر على واجهة العرض الرئيسية.",
        "evidenceRequired": "Principal display panel and complete label artwork",
        "compliantWhen": "A clear product name appears on the principal display panel and identifies the food product",
        "commonNonConformities": "Product name is missing, obscured, or not shown on the principal display panel"
      },
      {
        "code": "GSO_9_02",
        "titleEn": "Does the name express the true nature of the product?",
        "titleAr": "هل يعبّر الاسم عن الطبيعة الحقيقية للمنتج؟",
        "priority": "High",
        "category": "Product Identity",
        "knowledgeBaseEn": "The product name shall accurately describe the true nature, identity, and type of the food. It shall not imply a different composition, quality, or category.",
        "knowledgeBaseAr": "يجب أن يصف اسم المنتج بدقة طبيعته الحقيقية وهويته ونوعه، وألا يوحي بتركيب أو جودة أو فئة مختلفة.",
        "evidenceRequired": "Product name, product specification, composition, and label artwork",
        "compliantWhen": "The name accurately reflects the product’s true nature, identity, type, and composition",
        "commonNonConformities": "The name implies an incorrect composition, quality, identity, or product category"
      },
      {
        "code": "GSO_9_03",
        "titleEn": "Is the name non-misleading?",
        "titleAr": "هل الاسم غير مضلِّل؟",
        "priority": "Critical",
        "category": "Product Identity",
        "knowledgeBaseEn": "The product name shall not contain any false, deceptive, or misleading words, descriptions, symbols, trademarks, or illustrations regarding the product's nature, composition, origin, quality, or characteristics.",
        "knowledgeBaseAr": "يجب ألا يتضمن اسم المنتج أي كلمات أو أوصاف أو رموز أو علامات تجارية أو صور كاذبة أو خادعة أو مضللة بشأن طبيعة المنتج أو تركيبه أو منشئه أو جودته أو خصائصه.",
        "evidenceRequired": "Product name, claims, symbols, trademarks, illustrations, and supporting product information",
        "compliantWhen": "The name and associated presentation are truthful and do not mislead about nature, composition, origin, quality, or characteristics",
        "commonNonConformities": "False, deceptive, exaggerated, or misleading wording, symbols, trademarks, or illustrations are used"
      },
      {
        "code": "GSO_9_04",
        "titleEn": "Is there a list of ingredients?",
        "titleAr": "هل توجد قائمة بالمكوّنات؟",
        "priority": "Critical",
        "category": "Ingredients & Allergens",
        "knowledgeBaseEn": "Ingredients List: A complete list of all ingredients used in the manufacture of the product, including compound ingredients, food additives, and processing ingredients where required.",
        "knowledgeBaseAr": "قائمة المكونات: قائمة كاملة بجميع المكونات المستخدمة في تصنيع المنتج، بما في ذلك المكونات المركبة والمضافات الغذائية ومكونات المعالجة حيثما يلزم.",
        "evidenceRequired": "Ingredient list, formulation, bill of materials, additive list, and compound-ingredient details",
        "compliantWhen": "A complete ingredient list declares all ingredients, compound ingredients, additives, and required processing ingredients",
        "commonNonConformities": "Ingredient list is missing or one or more required ingredients, additives, or compound ingredients are omitted"
      },
      {
        "code": "GSO_9_05",
        "titleEn": "Are ingredients arranged in descending order by weight?",
        "titleAr": "هل رُتِّبت المكوّنات تنازلياً حسب الوزن؟",
        "priority": "High",
        "category": "Ingredients & Allergens",
        "knowledgeBaseEn": "Ingredients shall be declared in descending order of their weight at the time of manufacture, beginning with the ingredient present in the greatest amount.",
        "knowledgeBaseAr": "يجب التصريح بالمكونات بترتيب تنازلي حسب أوزانها وقت التصنيع، بدءًا بالمكوّن الموجود بأكبر كمية.",
        "evidenceRequired": "Ingredient list and formulation quantities at the time of manufacture",
        "compliantWhen": "Ingredients are ordered from greatest to least by manufacturing weight",
        "commonNonConformities": "Ingredients are presented in the wrong sequence or the declared order conflicts with the formulation"
      },
      {
        "code": "GSO_9_06",
        "titleEn": "Are food additives disclosed in the regulatory manner?",
        "titleAr": "هل تم الإفصاح عن المضافات الغذائية بالطريقة النظامية؟",
        "priority": "High",
        "category": "Ingredients & Allergens",
        "knowledgeBaseEn": "Food additives shall be declared by their functional class followed by their specific name or INS number (e.g., Preservative: Sodium Benzoate (INS 211)).",
        "knowledgeBaseAr": "يجب التصريح بالمضافات الغذائية بذكر فئتها الوظيفية متبوعة باسمها المحدد أو رقم النظام الدولي للترقيم (INS)، مثل: مادة حافظة: بنزوات الصوديوم (INS 211).",
        "evidenceRequired": "Ingredient list, additive specification, formulation, and applicable additive records",
        "compliantWhen": "Each food additive is declared by functional class followed by its specific name or INS number",
        "commonNonConformities": "Additive is omitted, incorrectly named, lacks its functional class, or uses an incorrect INS number"
      },
      {
        "code": "GSO_9_07",
        "titleEn": "Are allergens disclosed when present?",
        "titleAr": "هل تم الإفصاح عن مسبّبات الحساسية عند وجودها؟",
        "priority": "Critical",
        "category": "Ingredients & Allergens",
        "knowledgeBaseEn": "Allergens shall be declared when present, including cereals containing gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, tree nuts, sesame, and sulphites where applicable.",
        "knowledgeBaseAr": "يجب الإفصاح عن مسببات الحساسية عند وجودها، بما في ذلك الحبوب المحتوية على الغلوتين، والقشريات، والبيض، والأسماك، والفول السوداني، وفول الصويا، والحليب، والمكسرات الشجرية، والسمسم، والكبريتيت عند الاقتضاء.",
        "evidenceRequired": "Ingredient list, formulation, allergen assessment, supplier declarations, and cross-contact review",
        "compliantWhen": "All allergens present in the product are clearly and correctly declared",
        "commonNonConformities": "A present allergen is omitted, hidden, ambiguous, or not emphasized as required"
      },
      {
        "code": "GSO_9_08",
        "titleEn": "Is the net content indicated?",
        "titleAr": "هل تم بيان المحتوى الصافي؟",
        "priority": "High",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Net Content: The actual quantity of food contained in the package, excluding packaging material, expressed by weight, volume, or count as appropriate.",
        "knowledgeBaseAr": "المحتوى الصافي: الكمية الفعلية من الغذاء الموجودة داخل العبوة، باستثناء مواد التعبئة والتغليف، ويُعبّر عنها بالوزن أو الحجم أو العدد حسب الاقتضاء.",
        "evidenceRequired": "Principal display panel, package specification, and declared net quantity",
        "compliantWhen": "The actual food quantity excluding packaging is clearly declared by weight, volume, or count as appropriate",
        "commonNonConformities": "Net content is missing, includes packaging, or does not represent the actual quantity"
      },
      {
        "code": "GSO_9_09",
        "titleEn": "Is the correct unit of measurement used?",
        "titleAr": "هل استُخدمت وحدة القياس الصحيحة؟",
        "priority": "Medium",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Net quantity shall be declared using approved metric units such as g, kg, mL, L, or number of units, depending on the nature of the product.",
        "knowledgeBaseAr": "يجب التصريح بالكمية الصافية باستخدام وحدات مترية معتمدة مثل g أو kg أو mL أو L أو عدد الوحدات، وفقًا لطبيعة المنتج.",
        "evidenceRequired": "Net quantity statement and package/product specification",
        "compliantWhen": "An approved metric unit appropriate to the product is used, such as g, kg, mL, L, or unit count",
        "commonNonConformities": "Incorrect, non-metric, unsuitable, or missing measurement unit"
      },
      {
        "code": "GSO_9_10",
        "titleEn": "Is the manufacturer/producer name present?",
        "titleAr": "هل اسم المُصنِّع/المنتِج موجود؟",
        "priority": "High",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "The name of the manufacturer, producer, packer, or the responsible food business operator shall be declared on the label.",
        "knowledgeBaseAr": "يجب ذكر اسم المُصنّع أو المُنتِج أو المُعبّئ أو مشغّل المنشأة الغذائية المسؤول على البطاقة.",
        "evidenceRequired": "Label artwork and responsible food business operator records",
        "compliantWhen": "The manufacturer, producer, packer, or responsible food business operator is clearly named",
        "commonNonConformities": "Responsible operator name is absent, incomplete, or inconsistent with supporting records"
      },
      {
        "code": "GSO_9_11",
        "titleEn": "Is the address present?",
        "titleAr": "هل العنوان موجود؟",
        "priority": "High",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "The physical address of the manufacturer, producer, packer, importer, or responsible business operator shall be provided to allow identification and traceability.",
        "knowledgeBaseAr": "يجب تقديم العنوان الفعلي للمُصنّع أو المُنتِج أو المُعبّئ أو المستورد أو مشغّل المنشأة المسؤول بما يتيح التعريف والتتبع.",
        "evidenceRequired": "Label artwork, company registration details, and traceability records",
        "compliantWhen": "A sufficient physical address identifies the responsible manufacturer, producer, packer, importer, or operator",
        "commonNonConformities": "Address is missing, incomplete, non-physical, or insufficient for identification and traceability"
      },
      {
        "code": "GSO_9_12",
        "titleEn": "Is the country of origin indicated?",
        "titleAr": "هل تم بيان بلد المنشأ؟",
        "priority": "Critical",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Country of Origin: The country where the product was manufactured or produced. The declared origin shall not mislead consumers regarding the true origin of the product.",
        "knowledgeBaseAr": "بلد المنشأ: البلد الذي صُنّع أو أُنتج فيه المنتج. ويجب ألا يضلل المنشأ المعلن المستهلكين بشأن المنشأ الحقيقي للمنتج.",
        "evidenceRequired": "Country-of-origin statement, manufacturing records, import documents, and label artwork",
        "compliantWhen": "The true country of manufacture or production is clearly and accurately declared",
        "commonNonConformities": "Origin is missing, false, ambiguous, or presented in a way that may mislead consumers"
      },
      {
        "code": "GSO_9_13",
        "titleEn": "Is the production date indicated?",
        "titleAr": "هل تم بيان تاريخ الإنتاج؟",
        "priority": "High",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Production Date: The date on which the product was manufactured or produced, declared in the approved date format.",
        "knowledgeBaseAr": "تاريخ الإنتاج: التاريخ الذي صُنّع أو أُنتج فيه المنتج، ويُصرّح به وفق صيغة التاريخ المعتمدة.",
        "evidenceRequired": "Date marking on the package, production records, and approved date format",
        "compliantWhen": "The production date is present, legible, and declared in the approved format",
        "commonNonConformities": "Production date is missing, illegible, incorrect, or uses an unapproved format"
      },
      {
        "code": "GSO_9_14",
        "titleEn": "Is the expiry date indicated?",
        "titleAr": "هل تم بيان تاريخ انتهاء الصلاحية؟",
        "priority": "Critical",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Expiry Date: The last date on which the product is expected to remain suitable for consumption when stored under the specified conditions, declared in the approved date format.",
        "knowledgeBaseAr": "تاريخ انتهاء الصلاحية: آخر تاريخ يُتوقع فيه أن يظل المنتج صالحًا للاستهلاك عند حفظه وفق الشروط المحددة، ويُصرّح به وفق صيغة التاريخ المعتمدة.",
        "evidenceRequired": "Expiry marking, shelf-life evidence, storage conditions, and approved date format",
        "compliantWhen": "The expiry date is present, legible, correctly formatted, and supported by the approved shelf life",
        "commonNonConformities": "Expiry date is missing, illegible, expired, incorrectly formatted, or unsupported by shelf-life evidence"
      },
      {
        "code": "GSO_9_15",
        "titleEn": "Are storage instructions present?",
        "titleAr": "هل توجد تعليمات التخزين؟",
        "priority": "High",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Storage Conditions: Instructions necessary to maintain the product's safety and quality, such as \"Store in a cool, dry place,\" \"Keep refrigerated,\" or other applicable conditions.",
        "knowledgeBaseAr": "شروط التخزين: التعليمات اللازمة للحفاظ على سلامة المنتج وجودته، مثل «يُحفظ في مكان بارد وجاف» أو «يُحفظ مبردًا» أو غيرها من الشروط المنطبقة.",
        "evidenceRequired": "Storage statement, product specification, stability evidence, and label artwork",
        "compliantWhen": "Applicable storage conditions are clearly stated and match the conditions needed to maintain safety and quality",
        "commonNonConformities": "Storage instructions are missing, incomplete, unclear, or inconsistent with stability requirements"
      },
      {
        "code": "GSO_9_16",
        "titleEn": "Is the batch/lot number present?",
        "titleAr": "هل يوجد رقم التشغيلة/الدفعة؟",
        "priority": "Critical",
        "category": "Mandatory Information",
        "knowledgeBaseEn": "Batch/Lot Number: A unique code identifying a specific production batch for traceability, quality control, and product recall purposes.",
        "knowledgeBaseAr": "رقم التشغيلة/الدفعة: رمز فريد يحدد دفعة إنتاج معينة لأغراض التتبع ومراقبة الجودة واستدعاء المنتج.",
        "evidenceRequired": "Batch/lot code on the package, production records, and traceability system",
        "compliantWhen": "A clear and unique batch or lot code links the product to its production records",
        "commonNonConformities": "Batch/lot code is missing, illegible, duplicated, or cannot support traceability and recall"
      },
      {
        "code": "GSO_9_17",
        "titleEn": "Are all data clear and easy to read?",
        "titleAr": "هل جميع البيانات واضحة وسهلة القراءة؟",
        "priority": "High",
        "category": "Presentation & Language",
        "knowledgeBaseEn": "Mandatory labeling information shall be legible, permanent, clearly visible, and presented in a manner that is easy for consumers to read under normal conditions of purchase and use.",
        "knowledgeBaseAr": "يجب أن تكون جميع بيانات البطاقة الإلزامية مقروءة ودائمة وواضحة الظهور، وأن تُقدّم بطريقة يسهل على المستهلكين قراءتها في الظروف المعتادة للشراء والاستخدام.",
        "evidenceRequired": "Physical label or print proof under normal purchase and use conditions",
        "compliantWhen": "All mandatory information is legible, permanent, conspicuous, and easy to read",
        "commonNonConformities": "Mandatory data is blurred, removable, hidden, obscured, low-contrast, or otherwise difficult to read"
      },
      {
        "code": "GSO_9_18",
        "titleEn": "Is Arabic language used according to requirements?",
        "titleAr": "هل استُخدمت اللغة العربية وفق المتطلبات؟",
        "priority": "Critical",
        "category": "Presentation & Language",
        "knowledgeBaseEn": "All mandatory labeling information shall be provided in Arabic. Additional languages may be used provided they are consistent with the Arabic text and do not alter its meaning.",
        "knowledgeBaseAr": "يجب تقديم جميع بيانات البطاقة الإلزامية باللغة العربية. ويجوز استخدام لغات إضافية شريطة اتساقها مع النص العربي وعدم تغيير معناه.",
        "evidenceRequired": "Arabic label artwork and side-by-side comparison of all language versions",
        "compliantWhen": "All mandatory information is provided in Arabic and every additional language is consistent with it",
        "commonNonConformities": "Mandatory Arabic text is missing, incomplete, mistranslated, or contradicted by another language"
      },
      {
        "code": "GSO_9_19",
        "titleEn": "Is the font size appropriate?",
        "titleAr": "هل حجم الخط مناسب؟",
        "priority": "Medium",
        "category": "Presentation & Language",
        "knowledgeBaseEn": "The font size of mandatory labeling information shall be sufficiently large and clear to ensure readability and shall not obscure or reduce the visibility of mandatory information.",
        "knowledgeBaseAr": "يجب أن يكون حجم خط بيانات البطاقة الإلزامية كبيرًا وواضحًا بما يكفي لضمان سهولة القراءة، وألا يحجب البيانات الإلزامية أو يقلل من وضوحها.",
        "evidenceRequired": "Final-size label artwork, physical label, and font-size measurement",
        "compliantWhen": "Mandatory information uses a sufficiently large and clear font without reducing visibility",
        "commonNonConformities": "Font is too small, condensed, obscured, or otherwise compromises readability"
      }
    ]
  },
  {
    "code": "FD_55",
    "titleEn": "Dietary Supplement (SFDA FD 55)",
    "titleAr": "المكملات الغذائية (SFDA FD 55)",
    "standard": "SFDA.FD 55:2021",
    "itemCount": 24,
    "items": [
      {
        "code": "FD_55_01",
        "titleEn": "Is the product classified as a dietary supplement according to the standard definition?",
        "titleAr": "هل صُنّف المنتج كمكمّل غذائي وفق التعريف القياسي؟",
        "priority": "Critical",
        "category": "Classification",
        "knowledgeBaseAr": "المكمل الغذائي هو منتج غذائي يهدف إلى استكمال النظام الغذائي الطبيعي، ويحتوي على مصدر مركز لعنصر غذائي واحد أو أكثر أو لمواد ذات تأثير غذائي أو فسيولوجي، ويستهلك بجرعات محددة، ولا يهدف إلى علاج الأمراض أو تشخيصها أو الوقاية منها.",
        "evidenceRequired": "Product composition, intended-use statement, product specification",
        "compliantWhen": "Product meets the dietary-supplement definition and contains concentrated nutritional or physiological substances for dose-based use",
        "commonNonConformities": "Product does not meet the dietary-supplement definition or lacks a qualifying nutritional/physiological purpose"
      },
      {
        "code": "FD_55_02",
        "titleEn": "Is the product neither a medicine, herbal preparation, nor any product outside the scope of dietary supplements?",
        "titleAr": "هل المنتج ليس دواءً ولا مُستحضراً عشبياً ولا أي منتج خارج نطاق المكملات الغذائية؟",
        "priority": "Critical",
        "category": "Classification",
        "knowledgeBaseAr": "لا يعتبر المنتج مكملًا غذائيًا إذا كان دواءً، أو مستحضرًا عشبيًا علاجيًا، أو مستحضرًا طبيًا، أو جهازًا طبيًا، أو أي منتج يخضع لأنظمة تنظيمية أخرى غير المكملات الغذائية.",
        "evidenceRequired": "Regulatory classification file and product presentation",
        "compliantWhen": "Product is not regulated as a medicine, therapeutic herbal preparation, medical device, or another excluded product type",
        "commonNonConformities": "Product is medicinal, therapeutic, a medical device, or otherwise outside the dietary-supplement scope"
      },
      {
        "code": "FD_55_03",
        "titleEn": "Is the product intended to support or supplement the normal diet rather than treat, diagnose, or prevent diseases?",
        "titleAr": "هل المنتج مُعدّ لدعم أو تكملة النظام الغذائي الطبيعي وليس لعلاج أو تشخيص أو الوقاية من الأمراض؟",
        "priority": "Critical",
        "category": "Classification",
        "knowledgeBaseAr": "الغرض من المكمل الغذائي هو استكمال النظام الغذائي أو دعم الوظائف الفسيولوجية الطبيعية، وليس علاج الأمراض أو تشخيصها أو الوقاية منها أو تخفيف أعراضها.",
        "evidenceRequired": "Claims, intended-use statement, label, and marketing materials",
        "compliantWhen": "Intended use is limited to supplementing the diet or supporting normal physiological functions",
        "commonNonConformities": "Disease treatment, diagnosis, prevention, or symptom-relief claims are made"
      },
      {
        "code": "FD_55_04",
        "titleEn": "Is the product not presented in a pharmaceutical form (such as capsules, tablets, pills, or injections), and not presented or packaged in a way that suggests it is a medicinal product?",
        "titleAr": "هل المنتج غير مُقدّم بشكل صيدلاني (كالكبسولات أو الأقراص أو الحبوب أو الحقن) ولا يُقدّم أو يُغلّف بطريقة توحي بأنه منتج دوائي؟",
        "priority": "High",
        "category": "Classification",
        "knowledgeBaseAr": "يجب ألا يُعرض أو يُسوَّق المنتج بطريقة توحي بأنه دواء، مثل استخدام أسماء دوائية أو ادعاءات علاجية أو تصميم عبوة يوحي بأنه منتج صيدلاني، حتى وإن كان في صورة كبسولات أو أقراص أو مسحوق أو سائل.",
        "evidenceRequired": "Dosage form, label design, product name, claims, and packaging",
        "compliantWhen": "Presentation does not imply a medicinal product and contains no medicinal naming or therapeutic positioning",
        "commonNonConformities": "Packaging, naming, or claims present the product as a medicine"
      },
      {
        "code": "FD_55_05",
        "titleEn": "Is the product name appropriate and not misleading to the consumer?",
        "titleAr": "هل اسم المنتج مناسب وغير مضلِّل للمستهلك؟",
        "priority": "High",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب ألا يحتوي اسم المنتج على ادعاءات علاجية أو أسماء توحي بالشفاء أو الوقاية أو التشخيص، وألا يسبب تضليلًا للمستهلك بشأن طبيعة المنتج أو فوائده.",
        "evidenceRequired": "Principal display panel and product artwork",
        "compliantWhen": "Product name is accurate, appropriate, and not misleading about identity or benefit",
        "commonNonConformities": "Misleading, therapeutic, preventive, or deceptive product name"
      },
      {
        "code": "FD_55_06",
        "titleEn": "Is the category name (Dietary Supplement / مكمل غذائي) stated where applicable?",
        "titleAr": "هل تم ذكر اسم الفئة (مكمل غذائي / Dietary Supplement) عند الاقتضاء؟",
        "priority": "High",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب أن يظهر على البطاقة اسم الفئة \"مكمل غذائي\" أو \"Dietary Supplement\" بصورة واضحة عند وجوب ذلك.",
        "evidenceRequired": "Principal display panel and bilingual label artwork",
        "compliantWhen": "The category name “Dietary Supplement / مكمل غذائي” is clearly stated when required",
        "commonNonConformities": "Required category statement is missing, unclear, or incorrectly worded"
      },
      {
        "code": "FD_55_07",
        "titleEn": "Is the dosage form / method of administration clearly stated on the label?",
        "titleAr": "هل تم بيان الشكل الجرعي / طريقة التناول بوضوح على الملصق؟",
        "priority": "Medium",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب توضيح شكل المنتج أو طريقة تناوله مثل: كبسولات، أقراص، مسحوق، سائل، أكياس، أقراص للمضغ، أقراص فوارة، قطرات، مع بيان طريقة الاستخدام إذا لزم الأمر.",
        "evidenceRequired": "Label artwork and directions for use",
        "compliantWhen": "Dosage form or administration method is clearly identified where applicable",
        "commonNonConformities": "Dosage form or method of administration is absent or unclear"
      },
      {
        "code": "FD_55_08",
        "titleEn": "Is the net quantity or number of units stated?",
        "titleAr": "هل تم بيان الكمية الصافية أو عدد الوحدات؟",
        "priority": "High",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب بيان الكمية الصافية مثل الوزن أو الحجم، أو عدد الوحدات داخل العبوة مثل 30 كبسولة أو 60 قرصًا أو 250 مل.",
        "evidenceRequired": "Principal display panel and package contents",
        "compliantWhen": "Net quantity, volume, weight, or number of units is clearly stated",
        "commonNonConformities": "Net quantity or unit count is missing, incorrect, or not clearly visible"
      },
      {
        "code": "FD_55_09",
        "titleEn": "Are all active nutritional ingredients listed?",
        "titleAr": "هل تم إدراج جميع المكوّنات الغذائية الفعّالة؟",
        "priority": "Critical",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب إدراج جميع المكونات الغذائية الفعالة مثل الفيتامينات، المعادن، الأحماض الأمينية، الأحماض الدهنية، المستخلصات النباتية، البروبيوتيك أو أي مكون غذائي فعال آخر.",
        "evidenceRequired": "Ingredient list, formulation, specification, and label",
        "compliantWhen": "All active nutritional ingredients are declared on the label",
        "commonNonConformities": "One or more active nutritional ingredients are omitted or ambiguously identified"
      },
      {
        "code": "FD_55_10",
        "titleEn": "Is the quantity of each active ingredient stated per dose?",
        "titleAr": "هل تم بيان كمية كل مكوّن فعّال لكل جرعة؟",
        "priority": "Critical",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب بيان كمية كل مكون فعال لكل جرعة موصى بها، وليس فقط لكل عبوة.",
        "evidenceRequired": "Supplement facts panel, formulation, and recommended dose",
        "compliantWhen": "Quantity of every active ingredient is stated per recommended dose",
        "commonNonConformities": "Amount is missing, declared only per pack, or not linked to the recommended dose"
      },
      {
        "code": "FD_55_11",
        "titleEn": "Are the units of measurement for the ingredients correct (mg, µg, IU, g, mL, etc.)?",
        "titleAr": "هل وحدات قياس المكوّنات صحيحة (ملغ، ميكروغرام، IU، غ، مل، إلخ)؟",
        "priority": "High",
        "category": "Composition & Use",
        "knowledgeBaseAr": "تستخدم الوحدات المناسبة حسب نوع المادة مثل g، mg، µg، IU، mL أو غيرها من الوحدات المعترف بها.",
        "evidenceRequired": "Supplement facts panel and ingredient specification",
        "compliantWhen": "Each ingredient quantity uses an appropriate recognized unit such as g, mg, µg, IU, or mL",
        "commonNonConformities": "Incorrect, missing, inconsistent, or unsuitable units are used"
      },
      {
        "code": "FD_55_12",
        "titleEn": "Are all other ingredients (inactive ingredients / excipients) listed?",
        "titleAr": "هل تم إدراج جميع المكوّنات الأخرى (المكوّنات غير الفعّالة / السواغات)؟",
        "priority": "High",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب إدراج جميع المكونات غير الفعالة مثل المواد المالئة، المثبتات، الملونات، المنكهات، المحليات، المواد الحافظة، والكبسولة نفسها عند الاقتضاء.",
        "evidenceRequired": "Full ingredient list, formulation, excipient declaration, and capsule shell details",
        "compliantWhen": "All inactive ingredients and excipients are declared where applicable",
        "commonNonConformities": "Fillers, stabilizers, colors, flavors, sweeteners, preservatives, or shell ingredients are omitted"
      },
      {
        "code": "FD_55_13",
        "titleEn": "Is the recommended daily dose stated?",
        "titleAr": "هل تم بيان الجرعة اليومية الموصى بها؟",
        "priority": "Critical",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب تحديد الجرعة اليومية الموصى بها بوضوح مثل: كبسولة واحدة يوميًا، أو قرصان يوميًا، أو 5 مل يوميًا.",
        "evidenceRequired": "Directions for use and recommended-dose statement",
        "compliantWhen": "Recommended daily dose is stated clearly and unambiguously",
        "commonNonConformities": "Recommended daily dose is missing, incomplete, or unclear"
      },
      {
        "code": "FD_55_14",
        "titleEn": "Are the instructions for use stated clearly?",
        "titleAr": "هل تم بيان تعليمات الاستخدام بوضوح؟",
        "priority": "High",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب أن توضح تعليمات الاستخدام مثل وقت التناول، طريقة التحضير، الحاجة إلى الماء، أو تناول المنتج مع الطعام إذا كان ذلك ضروريًا.",
        "evidenceRequired": "Directions for use and preparation instructions",
        "compliantWhen": "Instructions explain how and when to take or prepare the product where needed",
        "commonNonConformities": "Use, timing, preparation, water, or food-related instructions are missing or unclear"
      },
      {
        "code": "FD_55_15",
        "titleEn": "Is the intended user group specified where necessary?",
        "titleAr": "هل تم تحديد الفئة المستهدفة عند الضرورة؟",
        "priority": "Medium",
        "category": "Composition & Use",
        "knowledgeBaseAr": "يجب تحديد الفئة المستهدفة عندما يكون المنتج مخصصًا لفئة معينة مثل البالغين، الأطفال، كبار السن، الرياضيين أو النساء.",
        "evidenceRequired": "Label, product specification, and target-population justification",
        "compliantWhen": "Intended user group is specified whenever the product targets a particular population",
        "commonNonConformities": "Target population is omitted where necessary or conflicts with product suitability"
      },
      {
        "code": "FD_55_16",
        "titleEn": "Are the mandatory warnings included?",
        "titleAr": "هل تم تضمين التحذيرات الإلزامية؟",
        "priority": "Critical",
        "category": "Warnings & Safety",
        "knowledgeBaseAr": "تشمل التحذيرات الإلزامية جميع العبارات التي يتطلبها النظام لهذا المنتج بالإضافة إلى التحذيرات الخاصة بالمكونات عند الحاجة.",
        "evidenceRequired": "Warnings panel, ingredient-specific requirements, and regulatory checklist",
        "compliantWhen": "All mandatory and ingredient-specific warning statements are present",
        "commonNonConformities": "One or more mandatory or ingredient-specific warnings are missing"
      },
      {
        "code": "FD_55_17",
        "titleEn": "Are warnings for sensitive groups (pregnant women, breastfeeding women, children, etc.) included where necessary?",
        "titleAr": "هل تم تضمين تحذيرات الفئات الحساسة (الحوامل، المرضعات، الأطفال، إلخ) عند الضرورة؟",
        "priority": "Critical",
        "category": "Warnings & Safety",
        "knowledgeBaseAr": "يجب إدراج التحذيرات الخاصة بالفئات الحساسة إذا كان المنتج غير مناسب للحوامل أو المرضعات أو الأطفال أو مرضى معينين أو مستخدمي أدوية معينة.",
        "evidenceRequired": "Warnings panel and safety assessment for sensitive populations",
        "compliantWhen": "Applicable warnings for pregnancy, breastfeeding, children, medical conditions, or medicine users are included",
        "commonNonConformities": "Required sensitive-group contraindications or precautions are absent"
      },
      {
        "code": "FD_55_18",
        "titleEn": "Is the statement “Do not exceed the recommended daily dose,” or an equivalent statement, included?",
        "titleAr": "هل تم تضمين عبارة «لا تتجاوز الجرعة اليومية الموصى بها» أو ما يعادلها؟",
        "priority": "Critical",
        "category": "Warnings & Safety",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة عبارة: \"لا تتجاوز الجرعة اليومية الموصى بها\" أو عبارة تؤدي المعنى نفسه.",
        "evidenceRequired": "Warnings panel and daily-dose statement",
        "compliantWhen": "A clear statement not to exceed the recommended daily dose is included",
        "commonNonConformities": "The maximum-dose warning is missing or materially altered"
      },
      {
        "code": "FD_55_19",
        "titleEn": "Is a statement included that the dietary supplement is not a substitute for a balanced diet?",
        "titleAr": "هل تم تضمين عبارة بأن المكمّل الغذائي ليس بديلاً عن النظام الغذائي المتوازن؟",
        "priority": "High",
        "category": "Warnings & Safety",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة عبارة تفيد بأن المكمل الغذائي لا يغني عن النظام الغذائي المتوازن والمتنوع.",
        "evidenceRequired": "Warnings panel and mandatory statements",
        "compliantWhen": "Label states that the supplement is not a substitute for a balanced and varied diet",
        "commonNonConformities": "Balanced-diet substitute disclaimer is missing"
      },
      {
        "code": "FD_55_20",
        "titleEn": "Is the statement “Keep out of reach of children” included?",
        "titleAr": "هل تم تضمين عبارة «يُحفظ بعيداً عن متناول الأطفال»؟",
        "priority": "Critical",
        "category": "Warnings & Safety",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة عبارة \"يحفظ بعيدًا عن متناول الأطفال.\"",
        "evidenceRequired": "Warnings panel and mandatory statements",
        "compliantWhen": "“Keep out of reach of children” or an equivalent compliant statement is present",
        "commonNonConformities": "Child-safety statement is missing or unclear"
      },
      {
        "code": "FD_55_21",
        "titleEn": "Are the storage conditions stated?",
        "titleAr": "هل تم بيان ظروف التخزين؟",
        "priority": "Medium",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب بيان ظروف الحفظ مثل: يحفظ في مكان جاف، يحفظ بعيدًا عن الرطوبة، يحفظ دون 25°C، يحفظ بعيدًا عن أشعة الشمس، أو أي شروط تخزين خاصة بالمنتج.",
        "evidenceRequired": "Storage statement, stability data, and product specification",
        "compliantWhen": "Required storage conditions are clearly stated and consistent with stability requirements",
        "commonNonConformities": "Storage conditions are missing, incomplete, or inconsistent with supporting data"
      },
      {
        "code": "FD_55_22",
        "titleEn": "Is the production date stated where applicable?",
        "titleAr": "هل تم بيان تاريخ الإنتاج عند الاقتضاء؟",
        "priority": "Medium",
        "category": "Labeling",
        "knowledgeBaseAr": "تاريخ الإنتاج هو التاريخ الذي تم فيه تصنيع المنتج، ويذكر إذا كان النظام أو طبيعة المنتج تتطلب ذلك.",
        "evidenceRequired": "Date marking on label and production records",
        "compliantWhen": "Production date is stated where applicable and is clear and legible",
        "commonNonConformities": "Production date is missing when required, illegible, or inconsistent with records"
      },
      {
        "code": "FD_55_23",
        "titleEn": "Is the expiration date stated?",
        "titleAr": "هل تم بيان تاريخ انتهاء الصلاحية؟",
        "priority": "Critical",
        "category": "Labeling",
        "knowledgeBaseAr": "تاريخ انتهاء الصلاحية هو آخر تاريخ يضمن فيه المنتج مطابقته لمواصفاته عند حفظه بالشروط المحددة، ويجب أن يكون ظاهرًا وواضحًا.",
        "evidenceRequired": "Date marking on label and shelf-life documentation",
        "compliantWhen": "Expiration date is present, clear, legible, and consistent with shelf-life evidence",
        "commonNonConformities": "Expiration date is missing, illegible, expired, or inconsistent with approved shelf life"
      },
      {
        "code": "FD_55_24",
        "titleEn": "Does the label language comply with SFDA requirements?",
        "titleAr": "هل تمتثل لغة الملصق لمتطلبات الهيئة العامة للغذاء والدواء؟",
        "priority": "Critical",
        "category": "Labeling",
        "knowledgeBaseAr": "يجب أن تكون جميع البيانات الإلزامية مكتوبة باللغة العربية، ويجوز إضافة لغات أخرى بشرط ألا تتعارض مع النص العربي أو تغير معناه، وأن تكون جميع المعلومات متطابقة بين اللغات.",
        "evidenceRequired": "Arabic label artwork and comparison of all language versions",
        "compliantWhen": "All mandatory information appears in Arabic and other languages do not conflict with or alter the Arabic meaning",
        "commonNonConformities": "Arabic mandatory text is missing or different language versions are inconsistent"
      }
    ]
  },
  {
    "code": "FD_2233",
    "titleEn": "Nutrition Labeling (SFDA FD 2233)",
    "titleAr": "بطاقة القيمة الغذائية (SFDA FD 2233)",
    "standard": "SFDA FD 2233",
    "itemCount": 37,
    "items": [
      {
        "code": "FD_2233_01",
        "titleEn": "Is the product within the scope of nutrition labeling requirements?",
        "titleAr": "هل يقع المنتج ضمن نطاق متطلبات البطاقة الغذائية؟",
        "priority": "High",
        "category": "Scope",
        "knowledgeBaseEn": "All packaged food products.\nProcessed packaged foods.\nImported packaged foods.\nLocally produced packaged foods.\nPackaged beverages.\nMulti-ingredient packaged food products.\nAny packaged food not among exempted products in the standard.",
        "knowledgeBaseAr": "جميع المنتجات الغذائية المعبأة.\nالأغذية المعبأة المصنّعة.\nالأغذية المعبأة المستوردة.\nالأغذية المعبأة المنتجة محلياً.\nالمشروبات المعبأة.\nالمنتجات الغذائية المعبأة متعددة المكونات.\nأي غذاء معبأ غير مدرج ضمن المنتجات المعفاة في اللائحة.",
        "evidenceRequired": "Product label, product type identification",
        "compliantWhen": "Product is packaged food within standard scope",
        "commonNonConformities": "Claiming exemption incorrectly"
      },
      {
        "code": "FD_2233_02",
        "titleEn": "Is the product NOT among the exempted products from the standard?",
        "titleAr": "هل المنتج غير مدرج ضمن المنتجات المُعفاة من المواصفة؟",
        "priority": "High",
        "category": "Scope",
        "knowledgeBaseEn": "Foods with negligible energy and nutrient amounts that can be expressed as zero (e.g., spices and seasonings).\nFresh vegetables and fruits, including their mixtures, unless dried or with added ingredients.\nFresh or chilled raw meat, poultry, and fish without added water or seasonings.\nFoods sold directly to consumers from the preparation site (e.g., salads, baked goods, desserts, ready meals).\nSingle-ingredient food products such as rice, tea, coffee, and sugar.\nPackaged drinking water and mineral water.\nPackages with largest surface area less than 25 cm².\nFood additives.\nFoods requiring additional packaging or processing before sale to consumers.\nOuter packaging of self-service foods if nutrition information is on original package or accompanying panel.",
        "knowledgeBaseAr": "الأغذية ذات القيم الطاقية والمغذية الضئيلة التي يمكن التعبير عنها بصفر (مثل التوابل والبهارات).\nالخضار والفواكه الطازجة بما فيها خلطاتها، ما لم تكن مجففة أو مضافاً إليها مكونات.\nاللحوم والدواجن والأسماك النيئة الطازجة أو المبردة دون إضافة ماء أو توابل.\nالأغذية المباعة مباشرة للمستهلك من موقع تحضيرها (مثل السلطات والمخبوزات والحلويات والوجبات الجاهزة).\nالمنتجات الغذائية أحادية المكوّن مثل الأرز والشاي والقهوة والسكر.\nمياه الشرب المعبأة والمياه المعدنية.\nالعبوات التي تقل مساحة أكبر سطح فيها عن 25 سم².\nالمضافات الغذائية.\nالأغذية التي تتطلب تعبئة أو معالجة إضافية قبل بيعها للمستهلك.\nالعبوة الخارجية للأغذية ذاتية الخدمة إذا كانت المعلومات التغذوية على العبوة الأصلية أو على لوحة مرافقة.",
        "evidenceRequired": "Product category assessment, packaging size measurement",
        "compliantWhen": "Product does NOT fall under any exemption category",
        "commonNonConformities": "Misclassifying product as exempt"
      },
      {
        "code": "FD_2233_03",
        "titleEn": "Is there a nutrition facts label on the product?",
        "titleAr": "هل توجد بطاقة حقائق غذائية على المنتج؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Definition of Nutrition Facts Label: A table or statement displaying the nutritional values of the product according to standard requirements.\nMay be titled:\nNutrition Facts\nNutrition Information\nالبيانات التغذوية\nالبطاقة التغذوية\nMust be visible on product packaging.\nMust include mandatory nutritional elements specified in the standard (such as energy, protein, fat, carbohydrates, etc.).\nCan be in Arabic or Arabic and English together, per approved labeling requirements.",
        "knowledgeBaseAr": "تعريف البطاقة التغذوية: جدول أو بيان يوضّح القيم التغذوية للمنتج وفقاً لمتطلبات اللائحة.\nقد تحمل العنوان:\nNutrition Facts\nNutrition Information\nالبيانات التغذوية\nالبطاقة التغذوية\nيجب أن تكون ظاهرة على عبوة المنتج.\nيجب أن تتضمن العناصر التغذوية الإلزامية المحددة في اللائحة (مثل الطاقة والبروتين والدهون والكربوهيدرات وغيرها).\nيمكن أن تكون باللغة العربية أو بالعربية والإنجليزية معاً وفقاً لمتطلبات البطاقة المعتمدة.",
        "evidenceRequired": "Visual inspection of label",
        "compliantWhen": "Nutrition facts panel is present and visible",
        "commonNonConformities": "Missing nutrition facts panel entirely"
      },
      {
        "code": "FD_2233_04",
        "titleEn": "Is energy value listed?",
        "titleAr": "هل تم بيان القيمة الطاقية (السعرات الحرارية)؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Nutrition facts label must include energy amount.\nEnergy may be expressed in:\nKilojoules (kJ).\nKilocalories (kcal) or Calories (Cal).\nOr both if specified by standard.\nEnergy must be declared:\nPer 100g or 100ml, or\nPer serving if required by presentation method in standard.\nEnergy value must be numeric with unit clearly stated.\nWhen using servings, serving size must be specified.",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة التغذوية مقدار الطاقة.\nيمكن التعبير عن الطاقة بـ:\nالكيلوجول (kJ).\nالكيلوسعرة (kcal) أو السعرات الحرارية (Cal).\nأو كليهما إذا نصّت اللائحة على ذلك.\nيجب الإعلان عن الطاقة:\nلكل 100 غرام أو 100 مل، أو\nلكل حصة إذا تطلبت طريقة العرض في اللائحة ذلك.\nيجب أن تكون قيمة الطاقة رقمية مع بيان الوحدة بوضوح.\nعند استخدام الحصص يجب تحديد حجم الحصة.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Energy value is declared with correct unit (kJ/kcal)",
        "commonNonConformities": "Energy missing or wrong unit"
      },
      {
        "code": "FD_2233_05",
        "titleEn": "Is protein listed?",
        "titleAr": "هل تم بيان البروتين؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Nutrition facts label must include protein amount. Expressed in grams (g), declared per 100g or 100ml or per single-serving package as per standard.",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة التغذوية مقدار البروتين. يُعبَّر عنه بالغرام (g)، ويُعلَن عنه لكل 100 غرام أو 100 مل أو لكل عبوة أحادية الحصة وفقاً للائحة.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Protein is declared in grams",
        "commonNonConformities": "Protein value missing"
      },
      {
        "code": "FD_2233_06",
        "titleEn": "Are carbohydrates listed?",
        "titleAr": "هل تم بيان الكربوهيدرات؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Label must include total carbohydrates amount. Expressed in grams (g), declared per 100g or 100ml or per single-serving package.",
        "knowledgeBaseAr": "يجب أن تتضمن البطاقة مقدار إجمالي الكربوهيدرات. يُعبَّر عنه بالغرام (g)، ويُعلَن عنه لكل 100 غرام أو 100 مل أو لكل عبوة أحادية الحصة.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Total carbohydrates declared in grams",
        "commonNonConformities": "Carbohydrates missing"
      },
      {
        "code": "FD_2233_07",
        "titleEn": "Is total fat listed?",
        "titleAr": "هل تم بيان إجمالي الدهون؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Total fat must be declared in nutrition label in grams (g) according to approved presentation method.",
        "knowledgeBaseAr": "يجب الإعلان عن إجمالي الدهون في البطاقة التغذوية بالغرام (g) وفقاً لطريقة العرض المعتمدة.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Total fat declared in grams",
        "commonNonConformities": "Total fat missing"
      },
      {
        "code": "FD_2233_08",
        "titleEn": "Is saturated fat listed?",
        "titleAr": "هل تم بيان الدهون المشبعة؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Saturated fat amount must be declared in grams (g) in nutrition label.",
        "knowledgeBaseAr": "يجب الإعلان عن مقدار الدهون المشبعة بالغرام (g) في البطاقة التغذوية.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Saturated fat declared in grams",
        "commonNonConformities": "Saturated fat missing"
      },
      {
        "code": "FD_2233_09",
        "titleEn": "Is trans fat listed?",
        "titleAr": "هل تم بيان الدهون المتحولة؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Trans fat amount must be declared if required by standard or when among mandatory elements.",
        "knowledgeBaseAr": "يجب الإعلان عن مقدار الدهون المتحولة إذا تطلبت اللائحة ذلك أو عند كونها ضمن العناصر الإلزامية.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Trans fat declared in grams",
        "commonNonConformities": "Trans fat missing or not declared when required"
      },
      {
        "code": "FD_2233_10",
        "titleEn": "Is cholesterol listed?",
        "titleAr": "هل تم بيان الكوليسترول؟",
        "priority": "High",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Cholesterol amount must be declared in milligrams (mg) when standard requires it.",
        "knowledgeBaseAr": "يجب الإعلان عن مقدار الكوليسترول بالمليغرام (mg) عندما تتطلب اللائحة ذلك.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Cholesterol declared in mg when required",
        "commonNonConformities": "Cholesterol missing when mandatory"
      },
      {
        "code": "FD_2233_11",
        "titleEn": "Is sodium listed?",
        "titleAr": "هل تم بيان الصوديوم؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Sodium amount must be declared in milligrams (mg).",
        "knowledgeBaseAr": "يجب الإعلان عن مقدار الصوديوم بالمليغرام (mg).",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Sodium declared in mg",
        "commonNonConformities": "Sodium missing"
      },
      {
        "code": "FD_2233_12",
        "titleEn": "Is total sugars listed?",
        "titleAr": "هل تم بيان إجمالي السكريات؟",
        "priority": "Critical",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Total sugars must be declared in grams (g) per standard requirements.",
        "knowledgeBaseAr": "يجب الإعلان عن إجمالي السكريات بالغرام (g) وفقاً لمتطلبات اللائحة.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Total sugars declared in grams",
        "commonNonConformities": "Sugars missing"
      },
      {
        "code": "FD_2233_13",
        "titleEn": "Is added sugars listed?",
        "titleAr": "هل تم بيان السكريات المضافة؟",
        "priority": "High",
        "category": "Mandatory Element",
        "knowledgeBaseEn": "Added sugars amount must be declared in grams (g) if standard requires it.",
        "knowledgeBaseAr": "يجب الإعلان عن مقدار السكريات المضافة بالغرام (g) إذا تطلبت اللائحة ذلك.",
        "evidenceRequired": "Nutrition facts panel review",
        "compliantWhen": "Added sugars declared separately in grams",
        "commonNonConformities": "Added sugars not separated from total"
      },
      {
        "code": "FD_2233_14",
        "titleEn": "If a nutrition claim is made, is the related nutrient disclosed?",
        "titleAr": "في حال وجود ادّعاء غذائي، هل تم الإفصاح عن المُغذّي ذي الصلة؟",
        "priority": "High",
        "category": "Claims Disclosure",
        "knowledgeBaseEn": "If a nutrition or health claim is made about a nutrient, that nutrient's value must be disclosed in nutrition label.",
        "knowledgeBaseAr": "إذا ورد ادعاء تغذوي أو صحي بشأن مغذٍّ ما، فيجب الإفصاح عن قيمة ذلك المغذّي في البطاقة التغذوية.",
        "evidenceRequired": "Label review for claims + nutrition panel",
        "compliantWhen": "Claimed nutrient is disclosed in nutrition panel",
        "commonNonConformities": "Making claim without declaring nutrient value"
      },
      {
        "code": "FD_2233_15",
        "titleEn": "When a nutrition or health claim exists, are the related nutrients disclosed?",
        "titleAr": "عند وجود ادّعاء غذائي أو صحي، هل تم الإفصاح عن المُغذّيات ذات الصلة؟",
        "priority": "High",
        "category": "Claims Disclosure",
        "knowledgeBaseEn": "All nutrients necessary to support the nutrition or health claim must be disclosed per standard requirements.",
        "knowledgeBaseAr": "يجب الإفصاح عن جميع المغذيات اللازمة لدعم الادعاء التغذوي أو الصحي وفقاً لمتطلبات اللائحة.",
        "evidenceRequired": "Label review for claims + nutrition panel",
        "compliantWhen": "All claim-related nutrients disclosed",
        "commonNonConformities": "Partial disclosure of claim nutrients"
      },
      {
        "code": "FD_2233_16",
        "titleEn": "When fatty acids are declared, are the required types specified?",
        "titleAr": "عند الإعلان عن الأحماض الدهنية، هل تم تحديد الأنواع المطلوبة؟",
        "priority": "Medium",
        "category": "Fatty Acids",
        "knowledgeBaseEn": "When declaring fatty acids, required types must be specified (such as saturated, monounsaturated, polyunsaturated) per standard.",
        "knowledgeBaseAr": "عند الإعلان عن الأحماض الدهنية يجب تحديد الأنواع المطلوبة (مثل المشبعة وأحادية عدم التشبع ومتعددة عدم التشبع) وفقاً للائحة.",
        "evidenceRequired": "Nutrition panel fatty acid breakdown",
        "compliantWhen": "All required fatty acid types specified",
        "commonNonConformities": "Missing MUFA/PUFA when declaring fatty acids"
      },
      {
        "code": "FD_2233_17",
        "titleEn": "If vitamins or minerals are declared, do they meet declaration requirements?",
        "titleAr": "في حال الإعلان عن الفيتامينات أو المعادن، هل تستوفي متطلبات الإعلان؟",
        "priority": "Medium",
        "category": "Vitamins & Minerals",
        "knowledgeBaseEn": "Vitamins and minerals must meet declaration requirements and minimum limits specified in standard.",
        "knowledgeBaseAr": "يجب أن تستوفي الفيتامينات والمعادن متطلبات الإعلان والحدود الدنيا المحددة في اللائحة.",
        "evidenceRequired": "Nutrition panel + specification review",
        "compliantWhen": "V&M meet minimum declaration thresholds",
        "commonNonConformities": "Declaring V&M below significant amount"
      },
      {
        "code": "FD_2233_18",
        "titleEn": "Is energy calculated using approved conversion factors?",
        "titleAr": "هل تم حساب الطاقة باستخدام معاملات التحويل المعتمدة؟",
        "priority": "High",
        "category": "Calculation",
        "knowledgeBaseEn": "Energy must be calculated using approved conversion factors for nutrients (protein, carbohydrates, fat, etc. per standard).",
        "knowledgeBaseAr": "يجب حساب الطاقة باستخدام معاملات التحويل المعتمدة للمغذيات (البروتين والكربوهيدرات والدهون وغيرها وفقاً للائحة).",
        "evidenceRequired": "Lab analysis or formulation data",
        "compliantWhen": "Energy calculated using approved factors",
        "commonNonConformities": "Using incorrect conversion factors"
      },
      {
        "code": "FD_2233_19",
        "titleEn": "Is protein calculated using the correct conversion factor?",
        "titleAr": "هل تم حساب البروتين باستخدام معامل التحويل الصحيح؟",
        "priority": "Medium",
        "category": "Calculation",
        "knowledgeBaseEn": "Protein content must be calculated using appropriate nitrogen conversion factor for food type per standard.",
        "knowledgeBaseAr": "يجب حساب محتوى البروتين باستخدام معامل تحويل النيتروجين المناسب لنوع الغذاء وفقاً للائحة.",
        "evidenceRequired": "Protein calculation documentation",
        "compliantWhen": "Correct nitrogen conversion factor used",
        "commonNonConformities": "Wrong conversion factor for protein type"
      },
      {
        "code": "FD_2233_20",
        "titleEn": "Is energy expressed per 100g or 100ml or per single-serving package?",
        "titleAr": "هل يُعبّر عن الطاقة لكل 100غ أو 100مل أو للعبوة الفردية؟",
        "priority": "High",
        "category": "Format",
        "knowledgeBaseEn": "Energy must be displayed per 100g or 100ml, or per single-serving package when applicable.",
        "knowledgeBaseAr": "يجب عرض الطاقة لكل 100 غرام أو 100 مل، أو لكل عبوة أحادية الحصة عند الاقتضاء.",
        "evidenceRequired": "Nutrition panel layout review",
        "compliantWhen": "Energy per 100g/100ml or per package shown",
        "commonNonConformities": "Energy per serving only (without 100g/ml)"
      },
      {
        "code": "FD_2233_21",
        "titleEn": "Are protein, carbohydrates, and fat expressed in grams?",
        "titleAr": "هل يُعبّر عن البروتين والكربوهيدرات والدهون بالجرام؟",
        "priority": "Medium",
        "category": "Format",
        "knowledgeBaseEn": "Protein, carbohydrates, and fat must be expressed in grams (g).",
        "knowledgeBaseAr": "يجب التعبير عن البروتين والكربوهيدرات والدهون بالغرام (g).",
        "evidenceRequired": "Unit verification",
        "compliantWhen": "Protein/carbs/fat in grams (g)",
        "commonNonConformities": "Using wrong units (mg, %, etc.)"
      },
      {
        "code": "FD_2233_22",
        "titleEn": "Are vitamins and minerals expressed in correct metric units?",
        "titleAr": "هل يُعبّر عن الفيتامينات والمعادن بالوحدات المترية الصحيحة؟",
        "priority": "Medium",
        "category": "Format",
        "knowledgeBaseEn": "Approved metric units must be used for each vitamin or mineral (such as mg or µg).",
        "knowledgeBaseAr": "يجب استخدام الوحدات المترية المعتمدة لكل فيتامين أو معدن (مثل mg أو µg).",
        "evidenceRequired": "Unit verification",
        "compliantWhen": "V&M in correct metric units (mg, µg)",
        "commonNonConformities": "Mixing units or using IU incorrectly"
      },
      {
        "code": "FD_2233_23",
        "titleEn": "Is %Daily Value (%DV) shown when required?",
        "titleAr": "هل تم إظهار النسبة المئوية للقيمة اليومية (%DV) عند الحاجة؟",
        "priority": "High",
        "category": "Format",
        "knowledgeBaseEn": "When standard requires, %Daily Value (%DV) must be displayed using approved reference values.",
        "knowledgeBaseAr": "عندما تتطلب اللائحة ذلك، يجب عرض النسبة المئوية للقيمة اليومية (%DV) باستخدام القيم المرجعية المعتمدة.",
        "evidenceRequired": "%DV calculation and display",
        "compliantWhen": "%DV shown based on approved reference values",
        "commonNonConformities": "Missing %DV when required, wrong reference"
      },
      {
        "code": "FD_2233_24",
        "titleEn": "Are carbohydrates displayed correctly with sugars when required?",
        "titleAr": "هل تُعرَض الكربوهيدرات بشكل صحيح مع السكريات عند الحاجة؟",
        "priority": "Low",
        "category": "Format",
        "knowledgeBaseEn": "Carbohydrates must be displayed per standard order, with sugars shown when required.",
        "knowledgeBaseAr": "يجب عرض الكربوهيدرات وفق الترتيب المحدد في اللائحة، مع إظهار السكريات عند الاقتضاء.",
        "evidenceRequired": "Carbohydrate display review",
        "compliantWhen": "Carbs shown with sugars breakdown properly",
        "commonNonConformities": "Sugars not indented under carbohydrates"
      },
      {
        "code": "FD_2233_25",
        "titleEn": "Are fats and their derivatives arranged in the required format?",
        "titleAr": "هل تُرتّب الدهون ومشتقاتها بالصيغة المطلوبة؟",
        "priority": "Low",
        "category": "Format",
        "knowledgeBaseEn": "Fats and their components must be arranged per sequence specified in standard.",
        "knowledgeBaseAr": "يجب ترتيب الدهون ومكوناتها وفق التسلسل المحدد في اللائحة.",
        "evidenceRequired": "Fat display sequence review",
        "compliantWhen": "Fats arranged in required order",
        "commonNonConformities": "Wrong sequence of fat components"
      },
      {
        "code": "FD_2233_26",
        "titleEn": "Are calorie conversion factors used correctly (if optional)?",
        "titleAr": "هل تستخدم معاملات تحويل السعرات بشكل صحيح (إذا كانت اختيارية)؟",
        "priority": "Low",
        "category": "Calculation",
        "knowledgeBaseEn": "When using calorie conversion factors, they must be applied per approved values in standard.",
        "knowledgeBaseAr": "عند استخدام معاملات تحويل السعرات الحرارية يجب تطبيقها وفق القيم المعتمدة في اللائحة.",
        "evidenceRequired": "Conversion factor documentation",
        "compliantWhen": "Optional factors applied correctly",
        "commonNonConformities": "Misapplying optional conversion factors"
      },
      {
        "code": "FD_2233_27",
        "titleEn": "Is the 2000-calorie daily value statement added when %DV is used?",
        "titleAr": "هل تمت إضافة عبارة القيمة اليومية لـ 2000 سعرة حرارية عند استخدام %DV؟",
        "priority": "Medium",
        "category": "Format",
        "knowledgeBaseEn": "When displaying %DV, the 2000-calorie daily value statement must be included if required by standard.",
        "knowledgeBaseAr": "عند عرض النسبة المئوية للقيمة اليومية (%DV) يجب تضمين بيان القيمة اليومية المبني على 2000 سعرة حرارية إذا تطلبت اللائحة ذلك.",
        "evidenceRequired": "Footer statement review",
        "compliantWhen": "2000 kcal statement present when using %DV",
        "commonNonConformities": "Missing daily value footnote"
      },
      {
        "code": "FD_2233_28",
        "titleEn": "Are zero or (<) values used only when permitted by the standard?",
        "titleAr": "هل تُستخدم القيم الصفرية أو (<) فقط عندما تسمح بها المواصفة؟",
        "priority": "High",
        "category": "Values",
        "knowledgeBaseEn": "Zero (0) or (<) values may only be used in cases and limits permitted by standard.",
        "knowledgeBaseAr": "لا يجوز استخدام القيم صفر (0) أو (<) إلا في الحالات والحدود التي تسمح بها اللائحة.",
        "evidenceRequired": "Value verification against standard",
        "compliantWhen": "Zero/<values used only per standard rules",
        "commonNonConformities": "Using 0 when actual value requires declaration"
      },
      {
        "code": "FD_2233_29",
        "titleEn": "Are nutritional values rounded according to rounding rules?",
        "titleAr": "هل تم تقريب القيم الغذائية وفق قواعد التقريب؟",
        "priority": "Medium",
        "category": "Values",
        "knowledgeBaseEn": "Nutritional values must be rounded according to rounding rules specified in standard.",
        "knowledgeBaseAr": "يجب تقريب القيم التغذوية وفقاً لقواعد التقريب المحددة في اللائحة.",
        "evidenceRequired": "Rounding verification",
        "compliantWhen": "Values rounded per standard rounding rules",
        "commonNonConformities": "Over-rounding or under-rounding values"
      },
      {
        "code": "FD_2233_30",
        "titleEn": "Are nutritional values within acceptable tolerance limits?",
        "titleAr": "هل القيم الغذائية ضمن حدود التفاوت المقبولة؟",
        "priority": "Critical",
        "category": "Values",
        "knowledgeBaseEn": "Declared values must fall within acceptable tolerance limits compared to actual product values.",
        "knowledgeBaseAr": "يجب أن تقع القيم المعلنة ضمن حدود التسامح المقبولة مقارنة بالقيم الفعلية للمنتج.",
        "evidenceRequired": "Lab analysis comparison",
        "compliantWhen": "Declared values within tolerance limits",
        "commonNonConformities": "Values outside acceptable tolerance range"
      },
      {
        "code": "FD_2233_31",
        "titleEn": "Do declared values represent a true average of the product?",
        "titleAr": "هل تمثّل القيم المُعلنة المتوسط الحقيقي للمنتج؟",
        "priority": "High",
        "category": "Values",
        "knowledgeBaseEn": "Nutritional values must represent a true average reflecting the product throughout shelf life.",
        "knowledgeBaseAr": "يجب أن تمثّل القيم التغذوية متوسطاً حقيقياً يعكس المنتج طوال فترة صلاحيته.",
        "evidenceRequired": "Averaging methodology review",
        "compliantWhen": "Values represent true product average",
        "commonNonConformities": "Values based on single batch only"
      },
      {
        "code": "FD_2233_32",
        "titleEn": "Is nutrition data displayed in a table format (or linear if space is limited)?",
        "titleAr": "هل تُعرَض بيانات التغذية في شكل جدول (أو خطي إذا كانت المساحة محدودة)؟",
        "priority": "Medium",
        "category": "Presentation",
        "knowledgeBaseEn": "Nutrition data must be displayed in table format, linear format permitted if insufficient space per standard.",
        "knowledgeBaseAr": "يجب عرض البيانات التغذوية بصيغة جدول، ويُسمح بالصيغة الخطية عند عدم توفر مساحة كافية وفقاً للائحة.",
        "evidenceRequired": "Layout verification",
        "compliantWhen": "Data in table format (linear if space limited)",
        "commonNonConformities": "Scattered data, no clear table structure"
      },
      {
        "code": "FD_2233_33",
        "titleEn": "Are nutrients arranged in the approved order?",
        "titleAr": "هل تُرتّب المُغذّيات بالترتيب المعتمد؟",
        "priority": "Low",
        "category": "Presentation",
        "knowledgeBaseEn": "Nutrient order must match sequence specified in standard.",
        "knowledgeBaseAr": "يجب أن يتطابق ترتيب المغذيات مع التسلسل المحدد في اللائحة.",
        "evidenceRequired": "Nutrient sequence review",
        "compliantWhen": "Nutrients in approved sequence order",
        "commonNonConformities": "Random nutrient arrangement"
      },
      {
        "code": "FD_2233_34",
        "titleEn": "Does font size emphasize energy and serving size?",
        "titleAr": "هل يُبرز حجم الخط الطاقة وحجم الحصة؟",
        "priority": "Low",
        "category": "Presentation",
        "knowledgeBaseEn": "Font size and emphasis on energy and serving size must match presentation requirements in standard.",
        "knowledgeBaseAr": "يجب أن يتطابق حجم الخط والتأكيد على الطاقة وحجم الحصة مع متطلبات العرض في اللائحة.",
        "evidenceRequired": "Font size measurement",
        "compliantWhen": "Energy and serving size emphasized",
        "commonNonConformities": "All text same size, no emphasis"
      },
      {
        "code": "FD_2233_35",
        "titleEn": "Is there sufficient contrast between text and background?",
        "titleAr": "هل يوجد تباين كافٍ بين النص والخلفية؟",
        "priority": "Medium",
        "category": "Presentation",
        "knowledgeBaseEn": "Text must be clear and legible with sufficient contrast between text and background.",
        "knowledgeBaseAr": "يجب أن يكون النص واضحاً ومقروءاً مع وجود تباين كافٍ بين النص والخلفية.",
        "evidenceRequired": "Contrast assessment",
        "compliantWhen": "Sufficient text/background contrast",
        "commonNonConformities": "Poor readability, low contrast"
      },
      {
        "code": "FD_2233_36",
        "titleEn": "Does the numerical display comply with standard requirements?",
        "titleAr": "هل يمتثل العرض الرقمي لمتطلبات المواصفة؟",
        "priority": "Low",
        "category": "Presentation",
        "knowledgeBaseEn": "Number formatting, units, and display method must match standard requirements.",
        "knowledgeBaseAr": "يجب أن يتطابق تنسيق الأرقام والوحدات وطريقة العرض مع متطلبات اللائحة.",
        "evidenceRequired": "Numeric display review",
        "compliantWhen": "Numbers and units per standard format",
        "commonNonConformities": "Inconsistent number formatting"
      },
      {
        "code": "FD_2233_37",
        "titleEn": "If supplementary nutrition info is used, is it complementary (not replacement)?",
        "titleAr": "في حال استخدام معلومات تغذية تكميلية، هل هي مكمّلة (وليست بديلاً)؟",
        "priority": "Medium",
        "category": "Supplementary Info",
        "knowledgeBaseEn": "Supplementary nutrition information may be used provided it complements mandatory nutrition data and does not replace it.",
        "knowledgeBaseAr": "يجوز استخدام المعلومات التغذوية التكميلية شريطة أن تكمّل البيانات التغذوية الإلزامية وألا تحل محلها.",
        "evidenceRequired": "Additional nutrition info review",
        "compliantWhen": "Supplementary info complements, doesn't replace",
        "commonNonConformities": "FOP replacing back-of-pack nutrition facts"
      }
    ]
  },
  {
    "code": "FD_2333",
    "titleEn": "Health & Nutrition Claims (SFDA FD 2333)",
    "titleAr": "الادعاءات الصحية والغذائية (SFDA FD 2333)",
    "standard": "SFDA FD 2333",
    "itemCount": 14,
    "items": [
      {
        "code": "FD_2333_01",
        "titleEn": "Does the product contain a health or nutrition claim?",
        "titleAr": "هل يحتوي المنتج على ادّعاء صحي أو غذائي؟",
        "knowledgeBaseAr": "هل يحتوي المنتج على ادعاء صحي أو تغذوي؟",
        "evidenceRequired": "Label review for claim presence",
        "referenceRange": "SFDA FD 2333; Table 1!A1:R376; Table 2!A1:R50",
        "applicability": "Any claim on label",
        "decisionRule": "Identify if claim exists to determine applicable verification path."
      },
      {
        "code": "FD_2333_02",
        "titleEn": "If claim exists, is the quantity of nutrient related to the claim disclosed?",
        "titleAr": "في حال وجود ادّعاء، هل تم الإفصاح عن كمية المُغذّي ذي الصلة بالادّعاء؟",
        "knowledgeBaseAr": "إذا وجد ادعاء، هل تم الإفصاح عن كمية المغذي المتعلق بالادعاء؟",
        "evidenceRequired": "Label shows nutrient amount per serving",
        "referenceRange": "SFDA FD 2333; Table 1!M; Table 2!K",
        "applicability": "Nutrient quantity disclosure",
        "decisionRule": "Compliant when nutrient quantity supporting the claim is disclosed."
      },
      {
        "code": "FD_2333_03",
        "titleEn": "Are nutrition labeling requirements applied when using claims?",
        "titleAr": "هل تُطبّق متطلبات البطاقة الغذائية عند استخدام الادّعاءات؟",
        "knowledgeBaseAr": "هل تم تطبيق متطلبات البطاقة التغذوية عند استخدام الادعاءات؟",
        "evidenceRequired": "Complete nutrition label present",
        "referenceRange": "SFDA FD 2333; SFDA FD 2233",
        "applicability": "Nutrition facts panel",
        "decisionRule": "Compliant when full nutrition labeling accompanies any claim."
      },
      {
        "code": "FD_2333_04",
        "titleEn": "Is a statement about balanced diet importance added? (for health claims)",
        "titleAr": "هل تمت إضافة عبارة عن أهمية النظام الغذائي المتوازن؟ (للادّعاءات الصحية)",
        "knowledgeBaseAr": "هل تمت إضافة عبارة عن أهمية النظام الغذائي المتوازن؟ (للادعاءات الصحية)",
        "evidenceRequired": "Balanced diet statement on label",
        "referenceRange": "SFDA FD 2333; Table 1!M (Conditions)",
        "applicability": "Health claims only",
        "decisionRule": "Compliant when health claim includes balanced diet statement."
      },
      {
        "code": "FD_2333_05",
        "titleEn": "Is the product free from weight loss rate/amount claims?",
        "titleAr": "هل المنتج خالٍ من ادّعاءات معدّل أو مقدار فقدان الوزن؟",
        "knowledgeBaseAr": "هل المنتج خالٍ من ادعاءات معدل أو كمية فقدان الوزن؟",
        "evidenceRequired": "No specific weight loss rate/amount claims",
        "referenceRange": "SFDA FD 2333 prohibited claims",
        "applicability": "Weight loss claims",
        "decisionRule": "Compliant when no prohibited weight loss claims present."
      },
      {
        "code": "FD_2333_06",
        "titleEn": "Is the product free from claims containing physician recommendations?",
        "titleAr": "هل المنتج خالٍ من ادّعاءات تتضمّن توصيات الأطباء؟",
        "knowledgeBaseAr": "هل المنتج خالٍ من ادعاءات تحتوي على توصيات الأطباء؟",
        "evidenceRequired": "No physician recommendation claims",
        "referenceRange": "SFDA FD 2333 prohibited claims",
        "applicability": "Physician/medical endorsements",
        "decisionRule": "Compliant when no medical endorsement claims present."
      },
      {
        "code": "FD_2333_07",
        "titleEn": "Is the product free from prevention/treatment/cure claims?",
        "titleAr": "هل المنتج خالٍ من ادّعاءات الوقاية أو العلاج أو الشفاء؟",
        "knowledgeBaseAr": "هل المنتج خالٍ من ادعاءات الوقاية/العلاج/الشفاء؟",
        "evidenceRequired": "No prevention/treatment/cure claims",
        "referenceRange": "SFDA FD 2333 prohibited claims",
        "applicability": "Disease claims",
        "decisionRule": "Compliant when no disease-related claims present."
      },
      {
        "code": "FD_2333_08",
        "titleEn": "Are all claims verifiable?",
        "titleAr": "هل جميع الادّعاءات قابلة للتحقق؟",
        "knowledgeBaseAr": "هل جميع الادعاءات قابلة للتحقق؟",
        "evidenceRequired": "Scientific evidence or regulatory listing",
        "referenceRange": "SFDA FD 2333; Table 1; Table 2",
        "applicability": "All claims on label",
        "decisionRule": "Compliant when each claim can be verified against permitted lists."
      },
      {
        "code": "FD_2333_09",
        "titleEn": "Are claims free from meaningless statements or exaggerations?",
        "titleAr": "هل الادّعاءات خالية من العبارات التي لا معنى لها أو المبالغات؟",
        "knowledgeBaseAr": "هل الادعاءات خالية من العبارات غير المفيدة أو المبالغات؟",
        "evidenceRequired": "Clear, accurate, non-misleading language",
        "referenceRange": "SFDA FD 2333",
        "applicability": "All claim wording",
        "decisionRule": "Compliant when claims are factual without exaggeration."
      },
      {
        "code": "FD_2333_10",
        "titleEn": "If using health claim, is the claim listed in Table (1)?",
        "titleAr": "في حال استخدام ادّعاء صحي، هل هو مدرج في الجدول (1)؟",
        "knowledgeBaseAr": "إذا كان يستخدم ادعاء صحي، هل الادعاء مدرج في الجدول (1)؟",
        "evidenceRequired": "Exact match in Table 1 permitted claims",
        "referenceRange": "Table 1!A3:R376",
        "applicability": "Health claim text",
        "decisionRule": "Compliant only when health claim matches Table 1 entry."
      },
      {
        "code": "FD_2333_11",
        "titleEn": "If using health claim, are all conditions of use met?",
        "titleAr": "في حال استخدام ادّعاء صحي، هل تم استيفاء جميع شروط الاستخدام؟",
        "knowledgeBaseAr": "إذا كان يستخدم ادعاء صحي، هل تم استيفاء جميع شروط الاستخدام؟",
        "evidenceRequired": "Product meets all conditions in Table 1",
        "referenceRange": "Table 1!M (Conditions of use)",
        "applicability": "Matched claim conditions",
        "decisionRule": "Compliant when all Table 1 conditions for the claim are satisfied."
      },
      {
        "code": "FD_2333_12",
        "titleEn": "If using nutrition claim, is the claim listed in Table (2)?",
        "titleAr": "في حال استخدام ادّعاء غذائي، هل هو مدرج في الجدول (2)؟",
        "knowledgeBaseAr": "إذا كان يستخدم ادعاء تغذوي، هل الادعاء مدرج في الجدول (2)؟",
        "evidenceRequired": "Exact match in Table 2 permitted claims",
        "referenceRange": "Table 2!A3:R50",
        "applicability": "Nutrition claim text",
        "decisionRule": "Compliant only when nutrition claim matches Table 2 entry."
      },
      {
        "code": "FD_2333_13",
        "titleEn": "If using nutrition claim, are all conditions of use met?",
        "titleAr": "في حال استخدام ادّعاء غذائي، هل تم استيفاء جميع شروط الاستخدام؟",
        "knowledgeBaseAr": "إذا كان يستخدم ادعاء تغذوي، هل تم استيفاء جميع شروط الاستخدام؟",
        "evidenceRequired": "Product meets all conditions in Table 2",
        "referenceRange": "Table 2!K (Conditions of use)",
        "applicability": "Matched claim conditions",
        "decisionRule": "Compliant when all Table 2 conditions for the claim are satisfied."
      },
      {
        "code": "FD_2333_14",
        "titleEn": "Is the claim wording clear, correct, and not misleading?",
        "titleAr": "هل صياغة الادّعاء واضحة وصحيحة وغير مضلِّلة؟",
        "knowledgeBaseAr": "هل صياغة الادعاء واضحة وصحيحة وغير مضللة؟",
        "evidenceRequired": "Wording matches permitted claim language",
        "referenceRange": "SFDA FD 2333; Table 1; Table 2",
        "applicability": "Final claim review",
        "decisionRule": "Compliant when claim wording aligns with regulatory requirements."
      }
    ]
  },
  {
    "code": "FD_2500",
    "titleEn": "Food Additives (SFDA FD 2500)",
    "titleAr": "المضافات الغذائية (SFDA FD 2500)",
    "standard": "SFDA FD 2500",
    "itemCount": 19,
    "items": [
      {
        "code": "FD_2500_01",
        "titleEn": "Have all additives listed in the ingredients been identified?",
        "titleAr": "هل تم تحديد جميع المضافات المدرجة في المكوّنات؟",
        "knowledgeBaseAr": "تم تحديد جميع المواد المضافة الواردة في قائمة المكونات.",
        "evidenceRequired": "Ingredient list with additive names and/or INS numbers.",
        "referenceRange": "SFDA-FD-2500!A2:B2; GMP All Additives!A5:E187; Food additive!A3:D51",
        "applicability": "All additives declared in the ingredient list",
        "decisionRule": "Compliant when every declared additive is identified."
      },
      {
        "code": "FD_2500_02",
        "titleEn": "Are all additives used authorized for Food Category 13.6 – Food Supplements?",
        "titleAr": "هل جميع المضافات المستخدمة مصرّح بها لفئة الأغذية 13.6 – المكملات الغذائية؟",
        "knowledgeBaseAr": "جميع المواد المضافة المستخدمة مصرح بها لفئة Food Category 13.6 – Food Supplements.",
        "evidenceRequired": "Exact match in the Category 13.6 permitted-additives table.",
        "referenceRange": "SFDA-FD-2500!A3:B3; Food additive!A3:D51",
        "applicability": "Match each additive name or INS number against Category 13.6",
        "decisionRule": "Compliant only when every additive is listed for Category 13.6."
      },
      {
        "code": "FD_2500_03",
        "titleEn": "Are the maximum permitted levels or GMP requirements met for each additive?",
        "titleAr": "هل تم استيفاء الحدود القصوى المسموح بها أو متطلبات ممارسات التصنيع الجيدة (GMP) لكل مضاف؟",
        "knowledgeBaseAr": "تم الالتزام بالحدود القصوى للاستخدام أو بمتطلبات GMP لكل مادة مضافة.",
        "evidenceRequired": "Formula quantity/concentration and the applicable max level or documented GMP justification.",
        "referenceRange": "SFDA-FD-2500!A4:B4; GMP All Additives!A5:E187; Food additive!A3:D51",
        "applicability": "Maximum level in mg/kg or GMP designation",
        "decisionRule": "Compliant when each quantitative limit is met, or GMP use is justified at the minimum technologically necessary level."
      },
      {
        "code": "FD_2500_04",
        "titleEn": "Are all restrictions and specification notes applicable to each additive complied with?",
        "titleAr": "هل تم الالتزام بجميع القيود وملاحظات المواصفة المنطبقة على كل مضاف؟",
        "knowledgeBaseAr": "تم الالتزام بجميع القيود والملاحظات (Notes) الواردة في المواصفة لكل مادة مضافة.",
        "evidenceRequired": "Assessment against every note number linked to the additive.",
        "referenceRange": "SFDA-FD-2500!A5:B5; Food additive!A3:D51",
        "applicability": "All note numbers shown for the matched additive",
        "decisionRule": "Compliant when all linked notes and restrictions are satisfied."
      },
      {
        "code": "FD_2500_05",
        "titleEn": "Where gelatin, lecithin, or mono- and diglycerides are used, has their source been verified in accordance with regulatory requirements?",
        "titleAr": "عند استخدام الجيلاتين أو الليسيثين أو المونو والداي جليسيريد، هل تم التحقق من مصدرها وفق المتطلبات النظامية؟",
        "knowledgeBaseAr": "في حال استخدام الجيلاتين (Gelatin) أو الليسيثين (Lecithin) أو الجلسريدات الأحادية والثنائية (Mono- & Diglycerides)، تم التحقق من مصدرها وفق المتطلبات التنظيمية.",
        "evidenceRequired": "Supplier declaration, origin statement, halal/animal-source evidence where applicable.",
        "referenceRange": "SFDA-FD-2500!A6:B6; GMP All Additives!A5:E187",
        "applicability": "Gelatin; Lecithin (INS 322(i)); Mono- and diglycerides (INS 471)",
        "decisionRule": "Compliant when required source documentation is available and acceptable."
      },
      {
        "code": "FD_2500_06",
        "titleEn": "Is the product free from any additive that is unauthorized or not listed for Food Supplements (Category 13.6)?",
        "titleAr": "هل المنتج خالٍ من أي مضاف غير مصرّح به أو غير مدرج للمكملات الغذائية (الفئة 13.6)؟",
        "knowledgeBaseAr": "لا توجد أي مادة مضافة غير مصرح بها أو غير مدرجة لفئة Food Supplements (13.6).",
        "evidenceRequired": "Reconciliation showing no ingredient additive remains unmatched to Category 13.6.",
        "referenceRange": "SFDA-FD-2500!A7:B7; GMP All Additives!A5:E187; Food additive!A3:D51",
        "applicability": "Any ingredient additive not found in the Category 13.6 table",
        "decisionRule": "Compliant when no unauthorized or unmatched additive remains."
      },
      {
        "code": "FD_2500_07",
        "titleEn": "Are all additives used permitted for Category 13.6 – Food Supplements?",
        "titleAr": "هل جميع المضافات المستخدمة مسموحة للفئة 13.6 – المكملات الغذائية؟",
        "knowledgeBaseAr": "جميع المواد المضافة المستخدمة مسموح بها لفئة 13.6 Food Supplements.",
        "evidenceRequired": "Exact match in the Category 13.6 permitted-additives table.",
        "referenceRange": "SFDA-FD-2500!A10:B10; Food additive!A3:D51",
        "applicability": "Match each additive name or INS number against Category 13.6",
        "decisionRule": "Compliant only when every additive is listed for Category 13.6."
      },
      {
        "code": "FD_2500_08",
        "titleEn": "Are the maximum levels or GMP requirements complied with for each additive?",
        "titleAr": "هل تم الالتزام بالحدود القصوى أو متطلبات GMP لكل مضاف؟",
        "knowledgeBaseAr": "تم الالتزام بالحدود القصوى أو GMP لكل مادة مضافة.",
        "evidenceRequired": "Formula quantity/concentration and the applicable max level or documented GMP justification.",
        "referenceRange": "SFDA-FD-2500!A11:B11; GMP All Additives!A5:E187; Food additive!A3:D51",
        "applicability": "Maximum level in mg/kg or GMP designation",
        "decisionRule": "Compliant when each quantitative limit is met, or GMP use is justified."
      },
      {
        "code": "FD_2500_09",
        "titleEn": "Where INS 960 or other stevia sweeteners are used, has the limit been calculated as Steviol Equivalents? (Note 26)",
        "titleAr": "عند استخدام INS 960 أو محلّيات الستيفيا الأخرى، هل تم حساب الحد كمكافئات ستيفيول؟ (ملاحظة 26)",
        "knowledgeBaseAr": "عند وجود INS 960 أو غيره من محليات الستيفيا تم احتساب الحد بوحدة Steviol Equivalents. (ملاحظة 26)",
        "evidenceRequired": "Calculation expressed as Steviol Equivalents.",
        "referenceRange": "SFDA-FD-2500!A12:B12; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Steviol glycosides; INS 960 series; Note 26",
        "decisionRule": "Compliant when the Steviol Equivalent result is within the applicable limit."
      },
      {
        "code": "FD_2500_10",
        "titleEn": "Where benzoates are used, has the limit been calculated as Benzoic Acid? (Note 13)",
        "titleAr": "عند استخدام البنزوات، هل تم حساب الحد كحمض بنزويك؟ (ملاحظة 13)",
        "knowledgeBaseAr": "عند وجود بنزوات تم احتساب الحد على أساس Benzoic Acid. (ملاحظة 13)",
        "evidenceRequired": "Calculation expressed as Benzoic Acid.",
        "referenceRange": "SFDA-FD-2500!A13:B13; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Benzoates; INS 210-213; Note 13",
        "decisionRule": "Compliant when the Benzoic Acid equivalent is within the applicable limit."
      },
      {
        "code": "FD_2500_11",
        "titleEn": "Where sorbates are used, has the limit been calculated as Sorbic Acid? (Note 42)",
        "titleAr": "عند استخدام السوربات، هل تم حساب الحد كحمض سوربيك؟ (ملاحظة 42)",
        "knowledgeBaseAr": "عند وجود سوربات تم احتساب الحد على أساس Sorbic Acid. (ملاحظة 42)",
        "evidenceRequired": "Calculation expressed as Sorbic Acid.",
        "referenceRange": "SFDA-FD-2500!A14:B14; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Sorbates; INS 200-203; Note 42",
        "decisionRule": "Compliant when the Sorbic Acid equivalent is within the applicable limit."
      },
      {
        "code": "FD_2500_12",
        "titleEn": "Where tartrates are used, has the limit been calculated as Tartaric Acid? (Note 45)",
        "titleAr": "عند استخدام التارترات، هل تم حساب الحد كحمض طرطير؟ (ملاحظة 45)",
        "knowledgeBaseAr": "عند وجود الطرطرات تم احتساب الحد على أساس Tartaric Acid. (ملاحظة 45)",
        "evidenceRequired": "Calculation expressed as Tartaric Acid.",
        "referenceRange": "SFDA-FD-2500!A15:B15; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Tartrates; INS 334, 335(ii), 337; Note 45",
        "decisionRule": "Compliant when the Tartaric Acid equivalent is within the applicable limit."
      },
      {
        "code": "FD_2500_13",
        "titleEn": "Where phosphates are used, has the limit been calculated based on Phosphorus? (Note 33)",
        "titleAr": "عند استخدام الفوسفات، هل تم حساب الحد بناءً على الفوسفور؟ (ملاحظة 33)",
        "knowledgeBaseAr": "عند استخدام الفوسفات تم احتساب الحد على أساس Phosphorus. (ملاحظة 33)",
        "evidenceRequired": "Calculation expressed as Phosphorus.",
        "referenceRange": "SFDA-FD-2500!A16:B16; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Phosphates; listed phosphate INS numbers; Note 33",
        "decisionRule": "Compliant when the Phosphorus equivalent is within the applicable limit."
      },
      {
        "code": "FD_2500_14",
        "titleEn": "Where Aspartame, Acesulfame K, or INS 962 are used, has the combined limit been calculated according to the specification requirements? (Notes 113, 188, and 191)",
        "titleAr": "عند استخدام الأسبرتام أو أسيسولفام كي أو INS 962، هل تم حساب الحد المجمّع وفق متطلبات المواصفة؟ (الملاحظات 113 و188 و191)",
        "knowledgeBaseAr": "عند وجود Aspartame / Acesulfame K / INS 962 تم احتساب الحد المشترك وفق متطلبات المواصفة. (الملاحظات 113، 188، 191)",
        "evidenceRequired": "Combined sweetener calculation using the applicable notes.",
        "referenceRange": "SFDA-FD-2500!A17:B17; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Acesulfame K INS 950; Aspartame INS 951; Salt INS 962; Notes 188, 191, 113",
        "decisionRule": "Compliant when individual and combined sweetener limits are satisfied."
      },
      {
        "code": "FD_2500_15",
        "titleEn": "Where BHA, BHT, or Propyl Gallate antioxidants are used, have the individual or combined limits been calculated correctly? (Note 196)",
        "titleAr": "عند استخدام مضادات الأكسدة BHA أو BHT أو بروبيل جالات، هل تم حساب الحدود الفردية أو المجمّعة بشكل صحيح؟ (ملاحظة 196)",
        "knowledgeBaseAr": "عند استخدام مضادات الأكسدة BHA/BHT/Propyl Gallate تم احتساب الحدود منفردة أو مجتمعة. (ملاحظة 196)",
        "evidenceRequired": "Individual and combined antioxidant calculation.",
        "referenceRange": "SFDA-FD-2500!A18:B18; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "BHA INS 320; BHT INS 321; Propyl Gallate INS 310; Note 196",
        "decisionRule": "Compliant when individual and combined antioxidant limits are satisfied."
      },
      {
        "code": "FD_2500_16",
        "titleEn": "Where Sucrose Esters (INS 473, 473a, or 474) are used, has the limit been applied individually or in combination? (Note 348)",
        "titleAr": "عند استخدام إسترات السكروز (INS 473 أو 473a أو 474)، هل تم تطبيق الحد فردياً أو مجتمعاً؟ (ملاحظة 348)",
        "knowledgeBaseAr": "عند استخدام Sucrose Esters (INS 473/473a/474) تم تطبيق الحد منفردًا أو مجتمعًا. (ملاحظة 348)",
        "evidenceRequired": "Individual and combined Sucrose Ester calculation.",
        "referenceRange": "SFDA-FD-2500!A19:B19; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "INS 473, 473a, 474; Note 348",
        "decisionRule": "Compliant when the individual/combined limit is satisfied."
      },
      {
        "code": "FD_2500_17",
        "titleEn": "If the product is a chewable supplement, are the additives used permitted for this form? (Note 203)",
        "titleAr": "إذا كان المنتج مكمّلاً قابلاً للمضغ، هل المضافات المستخدمة مسموحة لهذا الشكل؟ (ملاحظة 203)",
        "knowledgeBaseAr": "إذا كان المنتج Chewable Supplement فالمواد المضافة المستخدمة مسموح بها لهذه الفئة. (ملاحظة 203)",
        "evidenceRequired": "Confirmation that the additive is permitted for chewable supplements.",
        "referenceRange": "SFDA-FD-2500!A20:B20; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Chewable supplement restrictions; Note 203",
        "decisionRule": "Compliant when Note 203 conditions are satisfied; otherwise N/A."
      },
      {
        "code": "FD_2500_18",
        "titleEn": "If the product is a capsule or tablet, are the restrictions applicable to this dosage form complied with? (Note 417)",
        "titleAr": "إذا كان المنتج كبسولة أو قرصاً، هل تم الالتزام بالقيود المنطبقة على هذا الشكل الجرعي؟ (ملاحظة 417)",
        "knowledgeBaseAr": "إذا كان المنتج Capsule أو Tablet فتم الالتزام بالقيود الخاصة بهذه الهيئة الدوائية. (ملاحظة 417)",
        "evidenceRequired": "Confirmation that capsule/tablet-specific restrictions are satisfied.",
        "referenceRange": "SFDA-FD-2500!A21:B21; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Capsule/tablet restrictions; Note 417",
        "decisionRule": "Compliant when Note 417 conditions are satisfied; otherwise N/A."
      },
      {
        "code": "FD_2500_19",
        "titleEn": "If the product contains fish oil, are the applicable limits complied with, including 6,000 mg/kg where applicable? (Note 418)",
        "titleAr": "إذا كان المنتج يحتوي على زيت السمك، هل تم الالتزام بالحدود المنطبقة، بما في ذلك 6,000 ملغ/كغم عند الاقتضاء؟ (ملاحظة 418)",
        "knowledgeBaseAr": "إذا كان المنتج يحتوي على Fish Oil فقد تم الالتزام بالحدود الخاصة به (6000 mg/kg عند انطباقها). (ملاحظة 418)",
        "evidenceRequired": "Fish-oil applicability assessment and concentration calculation.",
        "referenceRange": "SFDA-FD-2500!A22:B22; Food additive!A3:D51 (filter by Notes/INS)",
        "applicability": "Fish oil condition and 6000 mg/kg where applicable; Note 418",
        "decisionRule": "Compliant when Note 418 and the applicable 6000 mg/kg limit are satisfied; otherwise N/A."
      }
    ]
  }
];
