import { PrismaClient, Prisma, Role, RequestState, CommentDirection, ReturnReasonCode, FaultAttribution, CouponDiscountType, CouponAppliesTo, CouponClientScope, CouponStatus, OrganisationType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "Atlas@2026";
/** Must be ≥8 chars — login form + Zod enforce minLength 8. */
const ADMIN_PASSWORD = "AtlasAdmin1";

const labelMime = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
] as const;

const formulaMime = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
] as const;

async function main() {
  // Refuse to run against production — this wipes and reseeds demo data.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_PROD_SEED=1 only if you are certain.",
    );
  }

  // Wipe in dependency order for idempotent local reseeds
  await prisma.auditLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.notificationOutbox.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.couponRedemption.deleteMany();
  await prisma.paymentAllocation.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.requestComment.deleteMany();
  await prisma.requestEvent.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.requestDocument.deleteMany();
  await prisma.request.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.requiredDocument.deleteMany();
  await prisma.serviceItem.deleteMany();
  await prisma.subCategory.deleteMany();
  await prisma.mainCategory.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const adminPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // ── Atlas organisation + staff ───────────────────────────────────────────
  const atlas = await prisma.organisation.create({
    data: {
      type: OrganisationType.ATLAS,
      nameEn: "Atlas Support & Services",
      nameAr: "أطلس للمساندة والخدمات",
      logoKey: "orgs/atlas/logo.svg",
      email: "info@atls.com.sa",
      phone: "+966114666000",
      website: "https://atls.com.sa",
      crNumber: "1010384721",
      vatNumber: "300123456700003",
      addressLine1: "Olaya Street, Building 12",
      addressLine2: "Floor 3",
      city: "Riyadh",
      region: "Riyadh",
      postalCode: "12211",
      country: "SA",
      nationalAddress: "RHQA7521",
      creditLimit: new Prisma.Decimal(0),
      paymentTermsDays: 0,
      status: "ACTIVE",
    },
  });

  const [intake, reviewer, decisionMaker, admin] = await Promise.all([
    prisma.user.create({
      data: {
        organisationId: atlas.id,
        email: "intake@atls.com.sa",
        username: "intake.officer",
        passwordHash,
        fullNameEn: "Noura Al-Harbi",
        fullNameAr: "نورة الحربي",
        phone: "+966501110001",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.INTAKE_OFFICER }] },
      },
    }),
    prisma.user.create({
      data: {
        organisationId: atlas.id,
        email: "reviewer@atls.com.sa",
        username: "tech.reviewer",
        passwordHash,
        fullNameEn: "Eng. Khalid Al-Otaibi",
        fullNameAr: "م. خالد العتيبي",
        phone: "+966501110002",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.TECHNICAL_REVIEWER }] },
      },
    }),
    prisma.user.create({
      data: {
        organisationId: atlas.id,
        email: "decision@atls.com.sa",
        username: "decision.maker",
        passwordHash,
        fullNameEn: "Eng. Sara Al-Qahtani",
        fullNameAr: "م. سارة القحطاني",
        phone: "+966501110003",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.DECISION_MAKER }] },
      },
    }),
    prisma.user.create({
      data: {
        organisationId: atlas.id,
        email: "admin@atlas.com",
        username: "sys.admin",
        passwordHash: adminPasswordHash,
        fullNameEn: "Abdullah Al-Mutairi",
        fullNameAr: "عبدالله المطيري",
        phone: "+966501110004",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: Role.SYSTEM_ADMIN },
            { role: Role.CATALOGUE_MANAGER },
            { role: Role.FINANCE },
          ],
        },
      },
    }),
  ]);

  // ── Client organisations ─────────────────────────────────────────────────
  const alNoor = await prisma.organisation.create({
    data: {
      type: OrganisationType.CLIENT,
      nameEn: "Al Noor Pharmaceuticals Co.",
      nameAr: "شركة النور للصناعات الدوائية",
      logoKey: "orgs/al-noor/logo.png",
      email: "regulatory@alnoorpharma.sa",
      phone: "+966112345678",
      website: "https://alnoorpharma.sa",
      crNumber: "1010555123",
      vatNumber: "310987654300003",
      addressLine1: "Second Industrial City, Plot 214",
      addressLine2: "Warehouse B",
      city: "Riyadh",
      region: "Riyadh",
      postalCode: "14334",
      country: "SA",
      nationalAddress: "RRIAD2140",
      creditLimit: new Prisma.Decimal(75000),
      paymentTermsDays: 30,
      status: "ACTIVE",
    },
  });

  const gulfBeauty = await prisma.organisation.create({
    data: {
      type: OrganisationType.CLIENT,
      nameEn: "Gulf Beauty Trading LLC",
      nameAr: "الخليج لتجارة مستحضرات التجميل",
      logoKey: "orgs/gulf-beauty/logo.png",
      email: "compliance@gulfbeauty.sa",
      phone: "+966126789012",
      website: "https://gulfbeauty.sa",
      crNumber: "4030288741",
      vatNumber: "300556677800003",
      addressLine1: "Prince Sultan Road, Al Zahra District",
      addressLine2: "Office 8",
      city: "Jeddah",
      region: "Makkah",
      postalCode: "23425",
      country: "SA",
      nationalAddress: "JJEDA8821",
      creditLimit: new Prisma.Decimal(40000),
      paymentTermsDays: 15,
      status: "ACTIVE",
    },
  });

  const [alNoorOwner, alNoorUser] = await Promise.all([
    prisma.user.create({
      data: {
        organisationId: alNoor.id,
        email: "owner@alnoorpharma.sa",
        username: "alnoor.owner",
        passwordHash,
        fullNameEn: "Dr. Fahad Al-Subaie",
        fullNameAr: "د. فهد السبيعي",
        phone: "+966550010101",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: Role.CLIENT_OWNER },
            { role: Role.CLIENT_FINANCE },
          ],
        },
      },
    }),
    prisma.user.create({
      data: {
        organisationId: alNoor.id,
        email: "ra@alnoorpharma.sa",
        username: "alnoor.ra",
        passwordHash,
        fullNameEn: "Layla Al-Dosari",
        fullNameAr: "ليلى الدوسري",
        phone: "+966550010102",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.CLIENT_USER }] },
      },
    }),
  ]);

  const [gulfOwner, gulfUser] = await Promise.all([
    prisma.user.create({
      data: {
        organisationId: gulfBeauty.id,
        email: "owner@gulfbeauty.sa",
        username: "gulf.owner",
        passwordHash,
        fullNameEn: "Mona Al-Ghamdi",
        fullNameAr: "منى الغامدي",
        phone: "+966550020201",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.CLIENT_OWNER }] },
      },
    }),
    prisma.user.create({
      data: {
        organisationId: gulfBeauty.id,
        email: "labels@gulfbeauty.sa",
        username: "gulf.labels",
        passwordHash,
        fullNameEn: "Yousef Al-Harthi",
        fullNameAr: "يوسف الحارثي",
        phone: "+966550020202",
        locale: "en",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: {
          create: [
            { role: Role.CLIENT_USER },
            { role: Role.CLIENT_FINANCE },
          ],
        },
      },
    }),
  ]);

  // ── Catalogue: Food & Drugs ──────────────────────────────────────────────
  const foodDrugs = await prisma.mainCategory.create({
    data: {
      code: "FOOD_DRUGS",
      nameEn: "Food & Drugs",
      nameAr: "الغذاء والدواء",
      descEn:
        "Conformity assessment services against SFDA food, supplements, claims, and additives requirements.",
      descAr:
        "خدمات تقييم المطابقة وفق متطلبات الهيئة العامة للغذاء والدواء للأغذية والمكملات والادعاءات والمواد المضافة.",
      icon: "pill",
      sortOrder: 1,
      active: true,
    },
  });

  const [
    subSupplements,
    subGeneralFood,
    subNutrition,
    subClaims,
    subAdditives,
  ] = await Promise.all([
    prisma.subCategory.create({
      data: {
        mainCategoryId: foodDrugs.id,
        code: "FOOD_SUPPLEMENTS",
        nameEn: "Food Supplements",
        nameAr: "المكملات الغذائية",
        descEn: "Label and dossier assessment for food supplements under FD 55 and related SFDA rules.",
        descAr: "تقييم بطاقات وملفات المكملات الغذائية وفق اللائحة FD 55 والمتطلبات ذات الصلة.",
        sortOrder: 1,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: foodDrugs.id,
        code: "GENERAL_FOOD_LABELLING",
        nameEn: "General Food Labelling",
        nameAr: "بطاقة البيان العامة للأغذية",
        descEn: "Packaged food label assessment against GSO 9 / SFDA FD GSO 9.",
        descAr: "تقييم بطاقة الأغذية المعبأة وفق المواصفة GSO 9 / SFDA FD GSO 9.",
        sortOrder: 2,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: foodDrugs.id,
        code: "NUTRITION_LABELLING",
        nameEn: "Nutrition Labelling",
        nameAr: "بطاقة التغذية",
        descEn: "Nutrition facts panel verification against SFDA FD 2233.",
        descAr: "التحقق من لوحة الحقائق الغذائية وفق SFDA FD 2233.",
        sortOrder: 3,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: foodDrugs.id,
        code: "HEALTH_NUTRITION_CLAIMS",
        nameEn: "Health & Nutrition Claims",
        nameAr: "الادعاءات الصحية والتغذوية",
        descEn: "Claims substantiation review against SFDA FD 2333 and permitted claims tables.",
        descAr: "مراجعة إثبات الادعاءات وفق SFDA FD 2333 وجداول الادعاءات المسموح بها.",
        sortOrder: 4,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: foodDrugs.id,
        code: "FOOD_ADDITIVES",
        nameEn: "Food Additives",
        nameAr: "المواد المضافة للأغذية",
        descEn: "Formulation additive screening against SFDA FD 2500 and GMP lists.",
        descAr: "فحص المواد المضافة في التركيبة وفق SFDA FD 2500 وقوائم GMP.",
        sortOrder: 5,
      },
    }),
  ]);

  // ── Catalogue: Cosmetics ─────────────────────────────────────────────────
  const cosmetics = await prisma.mainCategory.create({
    data: {
      code: "COSMETICS",
      nameEn: "Cosmetics",
      nameAr: "مستحضرات التجميل",
      descEn:
        "Labelling, ingredient annex screening, claims, and dossier readiness for cosmetic products.",
      descAr:
        "تقييم بطاقات ومستندات مستحضرات التجميل وفحص المكونات والادعاءات وجاهزية الملفات.",
      icon: "sparkles",
      sortOrder: 2,
      active: true,
    },
  });

  const [
    subCosmeticLabel,
    subIngredient,
    subCosmeticClaims,
    subSafety,
    subNotification,
  ] = await Promise.all([
    prisma.subCategory.create({
      data: {
        mainCategoryId: cosmetics.id,
        code: "COSMETIC_LABELLING",
        nameEn: "Cosmetic Labelling",
        nameAr: "بطاقة مستحضرات التجميل",
        descEn: "Arabic/English cosmetic label assessment against GSO 1943 labelling articles.",
        descAr: "تقييم بطاقة مستحضر التجميل بالعربية والإنجليزية وفق مواد GSO 1943.",
        sortOrder: 1,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: cosmetics.id,
        code: "INGREDIENT_SCREENING",
        nameEn: "Ingredient Screening",
        nameAr: "فحص المكونات",
        descEn: "INCI screening against prohibited, restricted, colorant, preservative, and UV-filter annexes.",
        descAr: "فحص أسماء INCI مقابل ملاحق المحظور والمقيد والملونات والمواد الحافظة ومرشحات الأشعة فوق البنفسجية.",
        sortOrder: 2,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: cosmetics.id,
        code: "PRODUCT_CLAIMS",
        nameEn: "Product Claims",
        nameAr: "ادعاءات المنتج",
        descEn: "Cosmetic claims review against GSO claims rules and SFDA guidance.",
        descAr: "مراجعة ادعاءات مستحضرات التجميل وفق قواعد GSO وإرشادات الهيئة.",
        sortOrder: 3,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: cosmetics.id,
        code: "SAFETY_DOCUMENTATION",
        nameEn: "Safety Documentation",
        nameAr: "وثائق السلامة",
        descEn: "CPSR / PIF completeness review against GSO 1943 and PIF checklists.",
        descAr: "مراجعة اكتمال تقرير سلامة المنتج وملف معلومات المنتج وفق GSO 1943 وقوائم التحقق.",
        sortOrder: 4,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: cosmetics.id,
        code: "NOTIFICATION_DOSSIER",
        nameEn: "Notification Dossier",
        nameAr: "ملف الإخطار",
        descEn: "SFDA GHAD notification readiness checklist review.",
        descAr: "مراجعة جاهزية ملف الإخطار عبر منصة غد التابعة للهيئة.",
        sortOrder: 5,
      },
    }),
  ]);

  type DocSeed = {
    code: string;
    nameEn: string;
    nameAr: string;
    mandatory: boolean;
    acceptedMimeTypes: string[];
    helpEn: string;
    helpAr: string;
    sortOrder: number;
  };

  async function createServiceItem(input: {
    subCategoryId: string;
    code: string;
    nameEn: string;
    nameAr: string;
    descEn: string;
    descAr: string;
    basePrice: number;
    slaHours: number;
    sortOrder: number;
    docs: DocSeed[];
    productAttrSchema?: Prisma.InputJsonValue;
    checkSets?: Prisma.InputJsonValue;
  }) {
    return prisma.serviceItem.create({
      data: {
        subCategoryId: input.subCategoryId,
        code: input.code,
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        descEn: input.descEn,
        descAr: input.descAr,
        basePrice: new Prisma.Decimal(input.basePrice),
        vatRate: new Prisma.Decimal(0.15),
        resubmissionPricePct: new Prisma.Decimal(0.5),
        slaHours: input.slaHours,
        freeResubmissions: 0,
        maxResubmissions: 3,
        productAttrSchema: input.productAttrSchema ?? {},
        checkSets: input.checkSets ?? [],
        sortOrder: input.sortOrder,
        active: true,
        requiredDocuments: {
          create: input.docs.map((d) => ({
            code: d.code,
            nameEn: d.nameEn,
            nameAr: d.nameAr,
            mandatory: d.mandatory,
            acceptedMimeTypes: d.acceptedMimeTypes,
            maxSizeMb: 50,
            helpEn: d.helpEn,
            helpAr: d.helpAr,
            sortOrder: d.sortOrder,
          })),
        },
      },
      include: { requiredDocuments: true },
    });
  }

  const foodSupplementAttrs = {
    type: "object",
    properties: {
      dosage_form: {
        type: "string",
        enum: ["capsule", "tablet", "chewable", "powder", "liquid", "softgel", "gummy", "sachet"],
        titleEn: "Dosage form",
        titleAr: "شكل الجرعة",
        helpEn: "Drives which FD 2500 notes and chewable-specific rules apply.",
        helpAr: "يحدد أي ملاحظات FD 2500 وقواعد القابل للمضغ تنطبق على المنتج.",
      },
      target_group: {
        type: "string",
        enum: ["adult", "child", "pregnant", "athlete", "elderly"],
        titleEn: "Target group",
        titleAr: "الفئة المستهدفة",
        helpEn: "Used to mark age-specific warnings as applicable or N/A.",
        helpAr: "يُستخدم لجعل تحذيرات العمر قابلة للتطبيق أو غير منطبقة.",
      },
      contains_fish_oil: {
        type: "boolean",
        titleEn: "Contains fish oil",
        titleAr: "يحتوي على زيت السمك",
        helpEn: "Triggers allergen and source-of-omega labelling checks.",
        helpAr: "يشغّل فحوصات مسببات الحساسية ومصدر أوميغا.",
      },
      has_nutrition_claim: {
        type: "boolean",
        titleEn: "Has nutrition claim",
        titleAr: "يتضمن ادعاءً تغذوياً",
        helpEn: "Opens FD 2333 nutrition-claim conditions for scoring.",
        helpAr: "يفتح شروط ادعاءات التغذية في FD 2333 للتقييم.",
      },
      has_health_claim: {
        type: "boolean",
        titleEn: "Has health claim",
        titleAr: "يتضمن ادعاءً صحياً",
        helpEn: "Opens Table 1/2 claim substantiation checks.",
        helpAr: "يفتح فحوصات إثبات ادعاءات الجدولين 1 و2.",
      },
    },
    required: ["dosage_form", "target_group", "contains_fish_oil", "has_nutrition_claim", "has_health_claim"],
  };

  const cosmeticAttrs = {
    type: "object",
    properties: {
      product_type: {
        type: "string",
        enum: ["leave-on", "rinse-off", "oral-care", "hair", "nail", "perfume"],
        titleEn: "Product type",
        titleAr: "نوع المنتج",
        helpEn: "Annex concentration limits differ for leave-on vs rinse-off products.",
        helpAr: "حدود تركيز الملاحق تختلف بين المنتجات التي تُترك والتي تُشطف.",
      },
      target_group: {
        type: "string",
        enum: ["general", "children", "professional"],
        titleEn: "Target group",
        titleAr: "الفئة المستهدفة",
        helpEn: "Affects mandatory warning statements on the label.",
        helpAr: "يؤثر على عبارات التحذير الإلزامية على البطاقة.",
      },
    },
    required: ["product_type", "target_group"],
  };

  const foodCheckSets = [
    { code: "GSO_9", titleEn: "GSO 9 — General labelling", titleAr: "GSO 9 — بطاقة البيان العامة" },
    { code: "FD_55", titleEn: "FD 55 — Food supplements", titleAr: "FD 55 — المكملات الغذائية" },
    { code: "FD_2233", titleEn: "FD 2233 — Nutrition labelling", titleAr: "FD 2233 — بطاقة التغذية" },
    { code: "FD_2333", titleEn: "FD 2333 — Claims", titleAr: "FD 2333 — الادعاءات" },
    { code: "FD_2500", titleEn: "FD 2500 — Additives", titleAr: "FD 2500 — المواد المضافة" },
  ];

  const cosmeticCheckSets = [
    { code: "GSO_1943", titleEn: "GSO 1943 — Cosmetic labelling", titleAr: "GSO 1943 — بطاقة مستحضرات التجميل" },
    { code: "ANNEX_SCREEN", titleEn: "Annex screening", titleAr: "فحص الملاحق" },
  ];

  const artworkDoc = (order: number): DocSeed => ({
    code: "ARTWORK",
    nameEn: "Final artwork / label PDF",
    nameAr: "الملف النهائي للبطاقة / التصميم",
    mandatory: true,
    acceptedMimeTypes: [...labelMime],
    helpEn: "Upload print-ready artwork at minimum 300 dpi. Include all panels.",
    helpAr: "ارفع التصميم الجاهز للطباعة بدقة لا تقل عن 300 نقطة لكل بوصة، مع جميع الأوجه.",
    sortOrder: order,
  });

  const formulaDoc = (order: number): DocSeed => ({
    code: "FORMULA",
    nameEn: "Full formula / composition",
    nameAr: "التركيبة الكاملة / المكونات",
    mandatory: true,
    acceptedMimeTypes: [...formulaMime],
    helpEn: "List all ingredients with quantities and units as declared for SFDA.",
    helpAr: "أدرج جميع المكونات بكمياتها ووحداتها كما تُصرَّح للهيئة.",
    sortOrder: order,
  });

  const coaDoc = (order: number): DocSeed => ({
    code: "COA",
    nameEn: "Certificate of Analysis",
    nameAr: "شهادة التحليل",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf"],
    helpEn: "Current batch CoA from an accredited laboratory.",
    helpAr: "شهادة تحليل للدفعة الحالية من مختبر معتمد.",
    sortOrder: order,
  });

  const claimsDoc = (order: number): DocSeed => ({
    code: "CLAIMS_EVIDENCE",
    nameEn: "Claims substantiation dossier",
    nameAr: "ملف إثبات الادعاءات",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf"],
    helpEn: "Scientific references and mapping of each claim to evidence.",
    helpAr: "المراجع العلمية وربط كل ادعاء بدليله.",
    sortOrder: order,
  });

  const inciDoc = (order: number): DocSeed => ({
    code: "INCI_LIST",
    nameEn: "INCI ingredient list",
    nameAr: "قائمة مكونات INCI",
    mandatory: true,
    acceptedMimeTypes: [...formulaMime],
    helpEn: "INCI names in descending concentration order with percentages where required.",
    helpAr: "أسماء INCI بترتيب تنازلي للتركيز مع النسب المئوية عند اللزوم.",
    sortOrder: order,
  });

  const cpsrDoc = (order: number): DocSeed => ({
    code: "CPSR",
    nameEn: "Cosmetic Product Safety Report",
    nameAr: "تقرير سلامة مستحضر التجميل",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf"],
    helpEn: "Parts A and B signed by a qualified safety assessor.",
    helpAr: "الجزءان أ وب موقّعان من مقيّم سلامة مؤهل.",
    sortOrder: order,
  });

  const pifDoc = (order: number): DocSeed => ({
    code: "PIF",
    nameEn: "Product Information File index",
    nameAr: "فهرس ملف معلومات المنتج",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf"],
    helpEn: "PIF table of contents with document locations.",
    helpAr: "فهرس ملف معلومات المنتج مع مواقع المستندات.",
    sortOrder: order,
  });

  const packagingDoc = (order: number): DocSeed => ({
    code: "PACKAGING_PHOTOS",
    nameEn: "Packaging photographs",
    nameAr: "صور العبوة",
    mandatory: false,
    acceptedMimeTypes: ["image/png", "image/jpeg", "application/pdf"],
    helpEn: "Clear photos of primary and secondary packaging if PDF panels are incomplete.",
    helpAr: "صور واضحة للعبوة الأولية والثانوية إذا كانت ألواح ملف PDF غير مكتملة.",
    sortOrder: order,
  });

  const translationDoc = (order: number): DocSeed => ({
    code: "AR_TRANSLATION",
    nameEn: "Arabic translation of label text",
    nameAr: "الترجمة العربية لنصوص البطاقة",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    helpEn: "Editable Arabic text matching the artwork panels.",
    helpAr: "نص عربي قابل للتعديل مطابق لألواح التصميم.",
    sortOrder: order,
  });

  const ghadDoc = (order: number): DocSeed => ({
    code: "GHAD_DRAFT",
    nameEn: "GHAD notification draft export",
    nameAr: "مسودة تصدير إخطار غد",
    mandatory: true,
    acceptedMimeTypes: ["application/pdf", "application/json"],
    helpEn: "Export or screenshot pack of fields prepared for SFDA GHAD.",
    helpAr: "تصدير أو لقطات لحقول الإخطار المُعدّة لمنصة غد.",
    sortOrder: order,
  });

  const serviceItemSeeds = [
    {
      subCategoryId: subSupplements.id,
      code: "SUPPLEMENT_LABEL_FULL",
      nameEn: "Supplement label assessment (full 113-item)",
      nameAr: "تقييم بطاقة المكمل الغذائي (113 بنداً كاملاً)",
      descEn: "Full conformity assessment against GSO 9, FD 55, FD 2233, FD 2333 and FD 2500.",
      descAr: "تقييم مطابقة كامل وفق GSO 9 وFD 55 وFD 2233 وFD 2333 وFD 2500.",
      basePrice: 4500,
      slaHours: 120,
      sortOrder: 1,
      docs: [artworkDoc(1), formulaDoc(2), coaDoc(3), claimsDoc(4), packagingDoc(5)],
    },
    {
      subCategoryId: subSupplements.id,
      code: "SUPPLEMENT_LABEL_REREVIEW",
      nameEn: "Supplement label — re-review after correction",
      nameAr: "إعادة تقييم بطاقة المكمل بعد التصحيح",
      descEn: "Delta review of corrected artwork against findings from a prior Atlas assessment.",
      descAr: "مراجعة فرق التصحيح على التصميم مقارنة بملاحظات تقييم أطلس السابق.",
      basePrice: 2250,
      slaHours: 72,
      sortOrder: 2,
      docs: [artworkDoc(1), formulaDoc(2), coaDoc(3)],
    },
    {
      subCategoryId: subGeneralFood.id,
      code: "PACKAGED_FOOD_LABEL",
      nameEn: "Packaged food label assessment",
      nameAr: "تقييم بطاقة الغذاء المعبأ",
      descEn: "General labelling assessment for packaged foods under SFDA FD GSO 9.",
      descAr: "تقييم بطاقة البيان العامة للأغذية المعبأة وفق SFDA FD GSO 9.",
      basePrice: 2800,
      slaHours: 96,
      sortOrder: 1,
      docs: [artworkDoc(1), translationDoc(2), packagingDoc(3)],
    },
    {
      subCategoryId: subNutrition.id,
      code: "NUTRITION_FACTS_VERIFY",
      nameEn: "Nutrition facts panel verification",
      nameAr: "التحقق من لوحة الحقائق الغذائية",
      descEn: "Numeric and format verification of the nutrition declaration against FD 2233.",
      descAr: "التحقق من الأرقام وتنسيق إعلان التغذية وفق FD 2233.",
      basePrice: 2200,
      slaHours: 72,
      sortOrder: 1,
      docs: [artworkDoc(1), formulaDoc(2), coaDoc(3)],
    },
    {
      subCategoryId: subClaims.id,
      code: "CLAIMS_SUBSTANTIATION",
      nameEn: "Health & nutrition claims substantiation",
      nameAr: "إثبات الادعاءات الصحية والتغذوية",
      descEn: "Map each claim to Table 1/2 conditions and supporting evidence under FD 2333.",
      descAr: "ربط كل ادعاء بشروط الجدولين 1 و2 والأدلة الداعمة وفق FD 2333.",
      basePrice: 3500,
      slaHours: 96,
      sortOrder: 1,
      docs: [artworkDoc(1), claimsDoc(2), formulaDoc(3), coaDoc(4)],
    },
    {
      subCategoryId: subClaims.id,
      code: "CLAIMS_PRESCREEN",
      nameEn: "Claims pre-screen (label text only)",
      nameAr: "فرز أولي للادعاءات (نص البطاقة فقط)",
      descEn: "Fast pre-screen of claim wording before full substantiation.",
      descAr: "فرز سريع لصياغة الادعاءات قبل ملف الإثبات الكامل.",
      basePrice: 1800,
      slaHours: 48,
      sortOrder: 2,
      docs: [artworkDoc(1), claimsDoc(2), translationDoc(3)],
    },
    {
      subCategoryId: subAdditives.id,
      code: "ADDITIVE_SCREEN_13_6",
      nameEn: "Formulation additive screening (Cat. 13.6)",
      nameAr: "فحص المواد المضافة في التركيبة (فئة 13.6)",
      descEn: "Deterministic screening of additives against Category 13.6 limits and GMP list.",
      descAr: "فحص حتمي للمواد المضافة مقابل حدود فئة 13.6 وقائمة GMP.",
      basePrice: 3000,
      slaHours: 72,
      sortOrder: 1,
      docs: [formulaDoc(1), coaDoc(2), artworkDoc(3)],
    },
    {
      subCategoryId: subCosmeticLabel.id,
      code: "COSMETIC_LABEL_AR_EN",
      nameEn: "Cosmetic label assessment (AR/EN)",
      nameAr: "تقييم بطاقة مستحضر التجميل (عربي/إنجليزي)",
      descEn: "Labelling articles review under GSO 1943 for leave-on and rinse-off products.",
      descAr: "مراجعة مواد بطاقة البيان وفق GSO 1943 للمنتجات التي تُترك أو تُشطف.",
      basePrice: 3200,
      slaHours: 96,
      sortOrder: 1,
      docs: [artworkDoc(1), inciDoc(2), translationDoc(3), packagingDoc(4)],
    },
    {
      subCategoryId: subIngredient.id,
      code: "INCI_ANNEX_SCREEN",
      nameEn: "INCI annex screening",
      nameAr: "فحص مكونات INCI مقابل الملاحق",
      descEn: "Set-difference screening against prohibited/restricted annex substances and limits.",
      descAr: "فحص فرق المجموعات مقابل المواد المحظورة/المقيدة وحدود التركيز.",
      basePrice: 2800,
      slaHours: 72,
      sortOrder: 1,
      docs: [inciDoc(1), formulaDoc(2), cpsrDoc(3)],
    },
    {
      subCategoryId: subCosmeticClaims.id,
      code: "COSMETIC_CLAIMS_REVIEW",
      nameEn: "Cosmetic claims review",
      nameAr: "مراجعة ادعاءات مستحضرات التجميل",
      descEn: "Review of efficacy and marketing claims against GSO rules and SFDA guidance.",
      descAr: "مراجعة ادعاءات الفاعلية والتسويق وفق قواعد GSO وإرشادات الهيئة.",
      basePrice: 2500,
      slaHours: 72,
      sortOrder: 1,
      docs: [artworkDoc(1), claimsDoc(2), inciDoc(3)],
    },
    {
      subCategoryId: subSafety.id,
      code: "CPSR_PIF_COMPLETE",
      nameEn: "CPSR / PIF completeness review",
      nameAr: "مراجعة اكتمال تقرير السلامة وملف معلومات المنتج",
      descEn: "Document-sufficiency review of CPSR Parts A/B and PIF structure.",
      descAr: "مراجعة كفاية مستندات تقرير السلامة (أ/ب) وهيكل ملف معلومات المنتج.",
      basePrice: 4000,
      slaHours: 120,
      sortOrder: 1,
      docs: [cpsrDoc(1), pifDoc(2), inciDoc(3), formulaDoc(4), coaDoc(5)],
    },
    {
      subCategoryId: subNotification.id,
      code: "GHAD_NOTIFICATION_READY",
      nameEn: "SFDA GHAD notification readiness",
      nameAr: "جاهزية إخطار غد لدى الهيئة",
      descEn: "Checklist review of fields and attachments before GHAD submission.",
      descAr: "مراجعة قائمة التحقق للحقول والمرفقات قبل تقديم الإخطار عبر غد.",
      basePrice: 1500,
      slaHours: 48,
      sortOrder: 1,
      docs: [ghadDoc(1), artworkDoc(2), inciDoc(3)],
    },
  ] as const;

  const createdServiceItems = [];
  for (const seed of serviceItemSeeds) {
    const isCosmetic = [
      subCosmeticLabel.id,
      subIngredient.id,
      subCosmeticClaims.id,
      subSafety.id,
      subNotification.id,
    ].includes(seed.subCategoryId);
    createdServiceItems.push(
      await createServiceItem({
        ...seed,
        docs: [...seed.docs],
        productAttrSchema: isCosmetic ? cosmeticAttrs : foodSupplementAttrs,
        checkSets: isCosmetic ? cosmeticCheckSets : foodCheckSets,
      }),
    );
  }

  const byCode = Object.fromEntries(
    createdServiceItems.map((item) => [item.code, item]),
  ) as Record<string, (typeof createdServiceItems)[number]>;

  const svcSupplementFull = byCode.SUPPLEMENT_LABEL_FULL;
  const svcNutrition = byCode.NUTRITION_FACTS_VERIFY;
  const svcClaimsFull = byCode.CLAIMS_SUBSTANTIATION;
  const svcCosmeticLabel = byCode.COSMETIC_LABEL_AR_EN;
  const svcInciScreen = byCode.INCI_ANNEX_SCREEN;
  const svcGhadReady = byCode.GHAD_NOTIFICATION_READY;
  // ── Coupons ──────────────────────────────────────────────────────────────
  const now = new Date();
  const validFrom = new Date(now.getFullYear(), 0, 1);
  const validTo = new Date(now.getFullYear(), 11, 31, 23, 59, 59);

  await prisma.coupon.create({
    data: {
      code: "WELCOME15",
      nameEn: "Welcome 15% for new clients",
      nameAr: "ترحيب 15٪ للعملاء الجدد",
      discountType: CouponDiscountType.PERCENT,
      value: new Prisma.Decimal(15),
      maxDiscountAmount: new Prisma.Decimal(1000),
      minOrderAmount: null,
      appliesTo: CouponAppliesTo.ALL,
      appliesToIds: [],
      clientScope: CouponClientScope.NEW_CLIENTS_ONLY,
      clientIds: [],
      validFrom,
      validTo,
      totalUsageLimit: 500,
      perClientLimit: 1,
      usedCount: 0,
      stackable: false,
      excludesResubmissions: true,
      status: CouponStatus.ACTIVE,
      createdByUserId: admin.id,
    },
  });

  const couponAtlas500 = await prisma.coupon.create({
    data: {
      code: "ATLAS500",
      nameEn: "Atlas 500 SAR fixed discount",
      nameAr: "خصم أطلس الثابت 500 ريال",
      discountType: CouponDiscountType.FIXED,
      value: new Prisma.Decimal(500),
      maxDiscountAmount: null,
      minOrderAmount: new Prisma.Decimal(3000),
      appliesTo: CouponAppliesTo.ALL,
      appliesToIds: [],
      clientScope: CouponClientScope.ALL,
      clientIds: [],
      validFrom,
      validTo,
      totalUsageLimit: 200,
      perClientLimit: 3,
      usedCount: 1,
      stackable: false,
      excludesResubmissions: true,
      status: CouponStatus.ACTIVE,
      createdByUserId: admin.id,
    },
  });

  const couponCosmetic10 = await prisma.coupon.create({
    data: {
      code: "COSMETIC10",
      nameEn: "10% off cosmetics services",
      nameAr: "خصم 10٪ على خدمات مستحضرات التجميل",
      discountType: CouponDiscountType.PERCENT,
      value: new Prisma.Decimal(10),
      maxDiscountAmount: new Prisma.Decimal(800),
      minOrderAmount: new Prisma.Decimal(1500),
      appliesTo: CouponAppliesTo.MAIN_CATEGORY,
      appliesToIds: [cosmetics.id],
      clientScope: CouponClientScope.ALL,
      clientIds: [],
      validFrom,
      validTo,
      totalUsageLimit: null,
      perClientLimit: 5,
      usedCount: 0,
      stackable: false,
      excludesResubmissions: true,
      status: CouponStatus.ACTIVE,
      createdByUserId: admin.id,
    },
  });
  // ── Helper: request with events / comments / docs ────────────────────────
  async function seedRequest(opts: {
    requestNo: string;
    organisationId: string;
    serviceItem: typeof svcSupplementFull;
    createdByUserId: string;
    assignedToUserId?: string;
    state: RequestState;
    productNameEn: string;
    productNameAr: string;
    brand: string;
    productAttrs: Prisma.InputJsonValue;
    submissionNo: number;
    priceCharged: number;
    discountApplied?: number;
    couponCode?: string;
    submittedAt?: Date;
    closedAt?: Date;
    slaDueAt?: Date;
    heldFromState?: RequestState;
    events: Array<{
      fromState?: RequestState;
      toState: RequestState;
      actorUserId: string;
      actorRole: Role;
      note?: string;
      reasonCode?: ReturnReasonCode;
      faultAttribution?: FaultAttribution;
      createdAt: Date;
      metadata?: Prisma.InputJsonValue;
    }>;
    comments?: Array<{
      authorUserId: string;
      direction: CommentDirection;
      reasonCode?: ReturnReasonCode;
      bodyEn: string;
      bodyAr: string;
      createdAt: Date;
    }>;
    attachFirstDoc?: boolean;
  }) {
    const price = new Prisma.Decimal(opts.priceCharged);
    const discount = new Prisma.Decimal(opts.discountApplied ?? 0);

    const request = await prisma.request.create({
      data: {
        requestNo: opts.requestNo,
        organisationId: opts.organisationId,
        serviceItemId: opts.serviceItem.id,
        createdByUserId: opts.createdByUserId,
        assignedToUserId: opts.assignedToUserId,
        state: opts.state,
        heldFromState: opts.heldFromState,
        productNameEn: opts.productNameEn,
        productNameAr: opts.productNameAr,
        brand: opts.brand,
        productAttrs: opts.productAttrs,
        submissionNo: opts.submissionNo,
        priceCharged: price,
        discountApplied: discount,
        couponCode: opts.couponCode,
        submittedAt: opts.submittedAt,
        closedAt: opts.closedAt,
        slaDueAt: opts.slaDueAt,
      },
    });

    for (const event of opts.events) {
      await prisma.requestEvent.create({
        data: {
          requestId: request.id,
          fromState: event.fromState,
          toState: event.toState,
          actorUserId: event.actorUserId,
          actorRole: event.actorRole,
          note: event.note,
          reasonCode: event.reasonCode,
          faultAttribution: event.faultAttribution,
          metadata: event.metadata ?? {},
          createdAt: event.createdAt,
        },
      });
    }

    for (const comment of opts.comments ?? []) {
      await prisma.requestComment.create({
        data: {
          requestId: request.id,
          authorUserId: comment.authorUserId,
          direction: comment.direction,
          reasonCode: comment.reasonCode,
          bodyEn: comment.bodyEn,
          bodyAr: comment.bodyAr,
          createdAt: comment.createdAt,
        },
      });
    }

    if (opts.attachFirstDoc && opts.serviceItem.requiredDocuments[0]) {
      const required = opts.serviceItem.requiredDocuments[0];
      const doc = await prisma.requestDocument.create({
        data: {
          requestId: request.id,
          requiredDocumentId: required.id,
          label: required.nameEn,
        },
      });
      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          version: 1,
          fileName: `${opts.requestNo.toLowerCase()}-artwork.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 2_458_112,
          storageKey: `uploads/${opts.organisationId}/${request.id}/v1-artwork.pdf`,
          sha256: `seed-${opts.requestNo}-sha256`,
          uploadedByUserId: opts.createdByUserId,
          avStatus: "CLEAN",
          uploadedAt: opts.submittedAt ?? now,
        },
      });
      await prisma.requestDocument.update({
        where: { id: doc.id },
        data: { currentVersionId: version.id },
      });
    }

    return request;
  }

  const daysAgo = (d: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    return date;
  };
  const hoursFrom = (base: Date, h: number) => {
    const date = new Date(base);
    date.setHours(date.getHours() + h);
    return date;
  };

  // 1) DRAFT — Al Noor
  await seedRequest({
    requestNo: "ATL-2026-000401",
    organisationId: alNoor.id,
    serviceItem: svcSupplementFull,
    createdByUserId: alNoorUser.id,
    state: RequestState.DRAFT,
    productNameEn: "Pure Quercetin 400 mg Capsules",
    productNameAr: "كبسولات كيرسيتين النقي 400 ملغ",
    brand: "Al Noor Vita",
    productAttrs: {
      dosage_form: "capsule",
      target_group: "adult",
      has_nutrition_claim: false,
      has_health_claim: true,
      contains_fish_oil: false,
    },
    submissionNo: 1,
    priceCharged: 4500,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        note: "Draft created",
        createdAt: daysAgo(2),
      },
    ],
  });

  // 2) UNDER_INTAKE_REVIEW — Al Noor
  const submitted2 = daysAgo(5);
  await seedRequest({
    requestNo: "ATL-2026-000402",
    organisationId: alNoor.id,
    serviceItem: svcNutrition,
    createdByUserId: alNoorUser.id,
    assignedToUserId: intake.id,
    state: RequestState.UNDER_INTAKE_REVIEW,
    productNameEn: "Date Protein Bar 40 g",
    productNameAr: "بار بروتين التمر 40 غرام",
    brand: "Oasis Fuel",
    productAttrs: {
      dosage_form: "bar",
      package_size_cm2: 180,
      has_nutrition_claim: true,
      has_health_claim: false,
    },
    submissionNo: 1,
    priceCharged: 2200,
    submittedAt: submitted2,
    slaDueAt: hoursFrom(submitted2, svcNutrition.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(6),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        note: "Submitted for intake",
        createdAt: submitted2,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        note: "Assigned to intake queue",
        createdAt: hoursFrom(submitted2, 2),
      },
    ],
    comments: [
      {
        authorUserId: alNoorUser.id,
        direction: CommentDirection.CLIENT_TO_ATLAS,
        bodyEn: "Nutrition panel was recalculated after reformulation in February 2026.",
        bodyAr: "أُعيد حساب لوحة التغذية بعد إعادة التركيبة في فبراير 2026.",
        createdAt: submitted2,
      },
    ],
  });

  // 3) RETURNED_TO_CLIENT — Al Noor (CLIENT_FAULT) — artwork missing panels
  const submitted3 = daysAgo(12);
  const returned3 = daysAgo(10);
  await seedRequest({
    requestNo: "ATL-2026-000403",
    organisationId: alNoor.id,
    serviceItem: svcSupplementFull,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: intake.id,
    state: RequestState.RETURNED_TO_CLIENT,
    productNameEn: "Omega-3 Softgels 1000 mg",
    productNameAr: "أوميغا-3 سوفتجل 1000 ملغ",
    brand: "Al Noor Marine",
    productAttrs: {
      dosage_form: "softgel",
      contains_fish_oil: true,
      target_group: "adult",
      has_health_claim: true,
    },
    submissionNo: 1,
    priceCharged: 4500,
    discountApplied: 500,
    couponCode: couponAtlas500.code,
    submittedAt: submitted3,
    slaDueAt: hoursFrom(submitted3, svcSupplementFull.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: daysAgo(13),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: submitted3,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted3, 4),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.RETURNED_TO_CLIENT,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        reasonCode: ReturnReasonCode.MISSING_ARTWORK,
        faultAttribution: FaultAttribution.CLIENT_FAULT,
        note: "Back panel and Arabic mandatory particulars missing from artwork PDF.",
        createdAt: returned3,
        metadata: { slaPaused: true },
      },
    ],
    comments: [
      {
        authorUserId: intake.id,
        direction: CommentDirection.ATLAS_TO_CLIENT,
        reasonCode: ReturnReasonCode.MISSING_ARTWORK,
        bodyEn:
          "Return to client: the uploaded artwork only contains the front panel. Please upload the full multi-panel PDF including Arabic mandatory particulars, then resubmit. Resubmission will be charged at 50% (2,250.00 SAR) because this is attributed to client fault.",
        bodyAr:
          "إعادة إلى العميل: ملف التصميم المرفوع يحتوي على الوجه الأمامي فقط. يرجى رفع ملف PDF متعدد الأوجه يتضمن البيانات الإلزامية بالعربية ثم إعادة التقديم. ستُحتسب إعادة التقديم بنسبة 50٪ (2,250.00 ر.س) لأن السبب يُنسب إلى العميل.",
        createdAt: returned3,
      },
    ],
  });

  await prisma.couponRedemption.create({
    data: {
      couponId: couponAtlas500.id,
      organisationId: alNoor.id,
      requestId: (await prisma.request.findUniqueOrThrow({ where: { requestNo: "ATL-2026-000403" } })).id,
      discountApplied: new Prisma.Decimal(500),
      redeemedAt: submitted3,
    },
  });

  // 4) Resubmission at 50% — same product, submissionNo 2, ACCEPTED → TECHNICAL_REVIEW path start
  const submitted4 = daysAgo(7);
  await seedRequest({
    requestNo: "ATL-2026-000404",
    organisationId: alNoor.id,
    serviceItem: svcSupplementFull,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: reviewer.id,
    state: RequestState.TECHNICAL_REVIEW,
    productNameEn: "Omega-3 Softgels 1000 mg",
    productNameAr: "أوميغا-3 سوفتجل 1000 ملغ",
    brand: "Al Noor Marine",
    productAttrs: {
      dosage_form: "softgel",
      contains_fish_oil: true,
      target_group: "adult",
      has_health_claim: true,
      prior_request_no: "ATL-2026-000403",
    },
    submissionNo: 2,
    priceCharged: 2250,
    submittedAt: submitted4,
    slaDueAt: hoursFrom(submitted4, svcSupplementFull.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        note: "Resubmission draft after return",
        createdAt: daysAgo(8),
        metadata: { priorRequestNo: "ATL-2026-000403", resubmissionPct: 0.5 },
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: submitted4,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted4, 1),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        note: "Documents sufficient; artwork locked",
        createdAt: hoursFrom(submitted4, 6),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted4, 6),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(submitted4, 7),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        note: "Draft evaluation ready for reviewer",
        createdAt: hoursFrom(submitted4, 8),
      },
    ],
    comments: [
      {
        authorUserId: alNoorOwner.id,
        direction: CommentDirection.CLIENT_TO_ATLAS,
        bodyEn: "Full multi-panel artwork and Arabic particulars uploaded for resubmission.",
        bodyAr: "تم رفع التصميم متعدد الأوجه والبيانات العربية لإعادة التقديم.",
        createdAt: submitted4,
      },
      {
        authorUserId: intake.id,
        direction: CommentDirection.INTERNAL,
        bodyEn: "Intake cleared. Charged resubmission at 50% of base price (CLIENT_FAULT on prior return).",
        bodyAr: "أُنجزت كفاية المستندات. احتُسبت إعادة التقديم بنسبة 50٪ من السعر الأساسي (خطأ العميل في الإعادة السابقة).",
        createdAt: hoursFrom(submitted4, 6),
      },
    ],
  });

  // 5) REPORT_ISSUED — Al Noor claims
  const submitted5 = daysAgo(40);
  const issued5 = daysAgo(28);
  await seedRequest({
    requestNo: "ATL-2026-000405",
    organisationId: alNoor.id,
    serviceItem: svcClaimsFull,
    createdByUserId: alNoorUser.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.REPORT_ISSUED,
    productNameEn: "Vitamin D3 5000 IU Tablets",
    productNameAr: "أقراص فيتامين د3 5000 وحدة دولية",
    brand: "Al Noor Vita",
    productAttrs: {
      dosage_form: "tablet",
      target_group: "adult",
      has_health_claim: true,
      has_nutrition_claim: true,
    },
    submissionNo: 1,
    priceCharged: 3500,
    submittedAt: submitted5,
    slaDueAt: hoursFrom(submitted5, svcClaimsFull.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(42),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: submitted5,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted5, 3),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted5, 10),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted5, 10),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(submitted5, 12),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: daysAgo(35),
      },
      {
        fromState: RequestState.TECHNICAL_REVIEW,
        toState: RequestState.DECISION,
        actorUserId: reviewer.id,
        actorRole: Role.TECHNICAL_REVIEWER,
        note: "Evaluation complete; forwarded to decision maker",
        createdAt: daysAgo(30),
      },
      {
        fromState: RequestState.DECISION,
        toState: RequestState.REPORT_ISSUED,
        actorUserId: decisionMaker.id,
        actorRole: Role.DECISION_MAKER,
        note: "Decision approved; summary and detailed reports issued",
        createdAt: issued5,
      },
    ],
    comments: [
      {
        authorUserId: decisionMaker.id,
        direction: CommentDirection.ATLAS_TO_CLIENT,
        bodyEn:
          "Report issued. Executive Summary and Detailed Findings are available for download. Verify at /verify/ATL-2026-000405.",
        bodyAr:
          "صدر التقرير. الملخص التنفيذي والتقرير التفصيلي متاحان للتحميل. تحقق عبر /verify/ATL-2026-000405.",
        createdAt: issued5,
      },
    ],
  });

  // 6) ASSESSMENT_RUNNING — Gulf Beauty cosmetic label
  const submitted6 = daysAgo(3);
  await seedRequest({
    requestNo: "ATL-2026-000406",
    organisationId: gulfBeauty.id,
    serviceItem: svcCosmeticLabel,
    createdByUserId: gulfUser.id,
    assignedToUserId: reviewer.id,
    state: RequestState.ASSESSMENT_RUNNING,
    productNameEn: "Hyaluronic Hydra Serum 30 ml",
    productNameAr: "سيروم الهيالورونيك المرطب 30 مل",
    brand: "Gulf Glow",
    productAttrs: {
      product_type: "leave-on",
      package_size_cm2: 95,
    },
    submissionNo: 1,
    priceCharged: 2880,
    discountApplied: 320,
    couponCode: couponCosmetic10.code,
    submittedAt: submitted6,
    slaDueAt: hoursFrom(submitted6, svcCosmeticLabel.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(4),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: submitted6,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted6, 2),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted6, 8),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted6, 8),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(submitted6, 10),
      },
    ],
  });

  const req406 = await prisma.request.findUniqueOrThrow({
    where: { requestNo: "ATL-2026-000406" },
  });
  await prisma.couponRedemption.create({
    data: {
      couponId: couponCosmetic10.id,
      organisationId: gulfBeauty.id,
      requestId: req406.id,
      discountApplied: new Prisma.Decimal(320),
      redeemedAt: submitted6,
    },
  });
  await prisma.coupon.update({
    where: { id: couponCosmetic10.id },
    data: { usedCount: 1 },
  });

  // 7) CLOSED — Gulf Beauty INCI screen
  const submitted7 = daysAgo(60);
  const closed7 = daysAgo(45);
  await seedRequest({
    requestNo: "ATL-2026-000407",
    organisationId: gulfBeauty.id,
    serviceItem: svcInciScreen,
    createdByUserId: gulfOwner.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.CLOSED,
    productNameEn: "Mineral Sunscreen SPF 50",
    productNameAr: "واقي شمس معدني عامل حماية 50",
    brand: "Gulf Glow",
    productAttrs: {
      product_type: "leave-on",
      uv_filters: true,
    },
    submissionNo: 1,
    priceCharged: 2800,
    submittedAt: submitted7,
    closedAt: closed7,
    slaDueAt: hoursFrom(submitted7, svcInciScreen.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: gulfOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: daysAgo(62),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: gulfOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: submitted7,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted7, 2),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted7, 9),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted7, 9),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(submitted7, 11),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: daysAgo(55),
      },
      {
        fromState: RequestState.TECHNICAL_REVIEW,
        toState: RequestState.DECISION,
        actorUserId: reviewer.id,
        actorRole: Role.TECHNICAL_REVIEWER,
        createdAt: daysAgo(50),
      },
      {
        fromState: RequestState.DECISION,
        toState: RequestState.REPORT_ISSUED,
        actorUserId: decisionMaker.id,
        actorRole: Role.DECISION_MAKER,
        createdAt: daysAgo(48),
      },
      {
        fromState: RequestState.REPORT_ISSUED,
        toState: RequestState.CLOSED,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        note: "File closed after retention handoff",
        createdAt: closed7,
      },
    ],
  });

  // 8) ON_HOLD — Gulf Beauty GHAD readiness
  const submitted8 = daysAgo(9);
  await seedRequest({
    requestNo: "ATL-2026-000408",
    organisationId: gulfBeauty.id,
    serviceItem: svcGhadReady,
    createdByUserId: gulfUser.id,
    assignedToUserId: intake.id,
    state: RequestState.ON_HOLD,
    heldFromState: RequestState.UNDER_INTAKE_REVIEW,
    productNameEn: "Rose Clay Face Mask 50 ml",
    productNameAr: "قناع الطين الوردي للوجه 50 مل",
    brand: "Gulf Glow",
    productAttrs: {
      product_type: "rinse-off",
    },
    submissionNo: 1,
    priceCharged: 1500,
    submittedAt: submitted8,
    slaDueAt: hoursFrom(submitted8, svcGhadReady.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(10),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: submitted8,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted8, 1),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ON_HOLD,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        reasonCode: ReturnReasonCode.EXPIRED_DOCUMENT,
        faultAttribution: FaultAttribution.CLIENT_FAULT,
        note: "Manufacturer ISO certificate expired; waiting for renewed certificate before continuing intake.",
        createdAt: daysAgo(8),
        metadata: { slaPaused: true, holdReason: "EXPIRED_MANUFACTURER_CERT" },
      },
    ],
    comments: [
      {
        authorUserId: intake.id,
        direction: CommentDirection.ATLAS_TO_CLIENT,
        reasonCode: ReturnReasonCode.EXPIRED_DOCUMENT,
        bodyEn:
          "Request placed on hold: the manufacturer ISO certificate expired on 2025-12-31. Upload the renewed certificate to resume intake. SLA is paused while on hold.",
        bodyAr:
          "وُضع الطلب قيد الإيقاف: شهادة الأيزو الخاصة بالمصنع انتهت في 2025-12-31. ارفع الشهادة المجددة لاستئناف الاستلام. ساعة مستوى الخدمة متوقفة أثناء الإيقاف.",
        createdAt: daysAgo(8),
      },
      {
        authorUserId: gulfUser.id,
        direction: CommentDirection.CLIENT_TO_ATLAS,
        bodyEn: "We have requested the renewed certificate from the manufacturer; expected within five working days.",
        bodyAr: "طلبنا الشهادة المجددة من المصنع؛ متوقعة خلال خمسة أيام عمل.",
        createdAt: daysAgo(7),
      },
    ],
  });

  // ── Demo commerce, queues, notifications (full E2E visibility) ───────────
  const allBilled = await prisma.request.findMany({
    where: {
      state: {
        in: [
          RequestState.SUBMITTED,
          RequestState.UNDER_INTAKE_REVIEW,
          RequestState.RETURNED_TO_CLIENT,
          RequestState.ACCEPTED,
          RequestState.ASSESSMENT_QUEUED,
          RequestState.ASSESSMENT_RUNNING,
          RequestState.TECHNICAL_REVIEW,
          RequestState.DECISION,
          RequestState.REPORT_ISSUED,
          RequestState.CLOSED,
        ],
      },
      submittedAt: { not: null },
    },
    include: { serviceItem: true },
    orderBy: { requestNo: "asc" },
  });

  let invSeq = 1;
  for (const req of allBilled) {
    if (req.state === RequestState.DRAFT) continue;
    const subtotal = req.priceCharged;
    const discount = req.discountApplied;
    const vat = subtotal.minus(discount).mul(0.15).toDecimalPlaces(2);
    const total = subtotal.minus(discount).plus(vat).toDecimalPlaces(2);
    const invoiceNo = `INV-2026-${String(invSeq).padStart(6, "0")}`;
    invSeq += 1;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo,
        organisationId: req.organisationId,
        requestId: req.id,
        subtotal,
        discount,
        vatAmount: vat,
        total,
        currency: "SAR",
        status:
          req.state === RequestState.CLOSED || req.state === RequestState.REPORT_ISSUED
            ? "PAID"
            : req.submissionNo > 1
              ? "PARTIALLY_PAID"
              : "ISSUED",
        issuedAt: req.submittedAt ?? daysAgo(1),
        dueAt: hoursFrom(req.submittedAt ?? daysAgo(1), 24 * 14),
        lines: {
          create: [
            {
              description: `${req.requestNo} · ${req.productNameEn}`,
              qty: 1,
              unitPrice: subtotal,
              lineTotal: subtotal,
            },
          ],
        },
      },
    });

    await prisma.ledgerEntry.create({
      data: {
        organisationId: req.organisationId,
        entryDate: req.submittedAt ?? daysAgo(1),
        type: "INVOICE",
        referenceType: "Invoice",
        referenceId: invoice.id,
        debit: total,
        credit: 0,
        descriptionEn: `Invoice ${invoiceNo} for ${req.requestNo}`,
        descriptionAr: `فاتورة ${invoiceNo} للطلب ${req.requestNo}`,
        createdByUserId: req.createdByUserId,
        createdAt: req.submittedAt ?? daysAgo(1),
      },
    });

    if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") {
      const payAmount =
        invoice.status === "PAID" ? total : total.mul(0.5).toDecimalPlaces(2);
      const payment = await prisma.payment.create({
        data: {
          organisationId: req.organisationId,
          amount: payAmount,
          method: "BANK_TRANSFER",
          reference: `TRX-${req.requestNo.slice(-4)}`,
          proofStorageKey: `uploads/${req.organisationId}/payments/${invoiceNo}-proof.pdf`,
          status: "CONFIRMED",
          receivedAt: hoursFrom(req.submittedAt ?? daysAgo(1), 48),
          confirmedByUserId: admin.id,
          confirmedAt: hoursFrom(req.submittedAt ?? daysAgo(1), 50),
        },
      });
      await prisma.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          amount: payAmount,
        },
      });
      await prisma.ledgerEntry.create({
        data: {
          organisationId: req.organisationId,
          entryDate: hoursFrom(req.submittedAt ?? daysAgo(1), 50),
          type: "PAYMENT",
          referenceType: "Payment",
          referenceId: payment.id,
          debit: 0,
          credit: payAmount,
          descriptionEn: `Payment confirmed for ${invoiceNo}`,
          descriptionAr: `تأكيد دفعة لـ ${invoiceNo}`,
          createdByUserId: admin.id,
        },
      });
    }
  }

  // Pending payment awaiting admin verification (finance queue)
  await prisma.payment.create({
    data: {
      organisationId: alNoor.id,
      amount: new Prisma.Decimal(5500),
      method: "BANK_TRANSFER",
      reference: "NCB-882341",
      proofStorageKey: `uploads/${alNoor.id}/payments/pending-ncb-proof.pdf`,
      status: "PENDING_VERIFICATION",
      receivedAt: daysAgo(1),
    },
  });
  await prisma.payment.create({
    data: {
      organisationId: gulfBeauty.id,
      amount: new Prisma.Decimal(1800),
      method: "CARD",
      reference: "VISA-4401",
      proofStorageKey: `uploads/${gulfBeauty.id}/payments/pending-card-proof.pdf`,
      status: "PENDING_VERIFICATION",
      receivedAt: hoursFrom(daysAgo(0), -6),
    },
  });

  // Extra open-queue requests so admin dashboard / queues look busy
  const slaRiskSubmit = daysAgo(4);
  await seedRequest({
    requestNo: "ATL-2026-000409",
    organisationId: alNoor.id,
    serviceItem: svcSupplementFull,
    createdByUserId: alNoorUser.id,
    assignedToUserId: intake.id,
    state: RequestState.SUBMITTED,
    productNameEn: "Vitamin D3 Drops 400 IU",
    productNameAr: "نقط فيتامين د3 400 وحدة",
    brand: "Al Noor Kids",
    productAttrs: { dosage_form: "liquid", target_group: "child" },
    submissionNo: 1,
    priceCharged: 3200,
    submittedAt: slaRiskSubmit,
    // Due soon → SLA at risk on admin dashboard
    slaDueAt: hoursFrom(slaRiskSubmit, 24),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(5),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorUser.id,
        actorRole: Role.CLIENT_USER,
        note: "Submitted — demo SLA at-risk item",
        createdAt: slaRiskSubmit,
      },
    ],
  });

  const techSubmit = daysAgo(9);
  await seedRequest({
    requestNo: "ATL-2026-000410",
    organisationId: gulfBeauty.id,
    serviceItem: svcCosmeticLabel,
    createdByUserId: gulfUser.id,
    assignedToUserId: reviewer.id,
    state: RequestState.TECHNICAL_REVIEW,
    productNameEn: "Niacinamide Serum 10%",
    productNameAr: "سيروم نياسيناميد 10٪",
    brand: "Gulf Glow",
    productAttrs: { product_type: "leave-on", target_group: "adult" },
    submissionNo: 1,
    priceCharged: 3600,
    submittedAt: techSubmit,
    slaDueAt: hoursFrom(techSubmit, svcCosmeticLabel.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: daysAgo(10),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: gulfUser.id,
        actorRole: Role.CLIENT_USER,
        createdAt: techSubmit,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(techSubmit, 3),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(techSubmit, 20),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(techSubmit, 20),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(techSubmit, 30),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(techSubmit, 50),
      },
    ],
  });

  const decisionSubmit = daysAgo(11);
  await seedRequest({
    requestNo: "ATL-2026-000411",
    organisationId: alNoor.id,
    serviceItem: svcNutrition,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.DECISION,
    productNameEn: "Whey Isolate Vanilla 1 kg",
    productNameAr: "واي عازل فانيلا 1 كغ",
    brand: "Al Noor Sport",
    productAttrs: {
      dosage_form: "powder",
      has_nutrition_claim: true,
      target_group: "athlete",
    },
    submissionNo: 1,
    priceCharged: 4100,
    submittedAt: decisionSubmit,
    slaDueAt: hoursFrom(decisionSubmit, svcNutrition.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: daysAgo(12),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: decisionSubmit,
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(decisionSubmit, 2),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(decisionSubmit, 10),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(decisionSubmit, 10),
      },
      {
        fromState: RequestState.ASSESSMENT_QUEUED,
        toState: RequestState.ASSESSMENT_RUNNING,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(decisionSubmit, 20),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: admin.id,
        actorRole: Role.SYSTEM_ADMIN,
        createdAt: hoursFrom(decisionSubmit, 40),
      },
      {
        fromState: RequestState.TECHNICAL_REVIEW,
        toState: RequestState.DECISION,
        actorUserId: reviewer.id,
        actorRole: Role.TECHNICAL_REVIEWER,
        note: "Technical pack complete — ready for decision",
        createdAt: hoursFrom(decisionSubmit, 70),
      },
    ],
  });

  // Second returned request (different reason) for attention band + return-reason chart
  const returnedB = daysAgo(3);
  await seedRequest({
    requestNo: "ATL-2026-000412",
    organisationId: alNoor.id,
    serviceItem: svcSupplementFull,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: intake.id,
    state: RequestState.RETURNED_TO_CLIENT,
    productNameEn: "Collagen Peptides Unflavoured",
    productNameAr: "ببتيدات الكولاجين بدون نكهة",
    brand: "Al Noor Beauty In",
    productAttrs: { dosage_form: "powder", target_group: "adult" },
    submissionNo: 1,
    priceCharged: 3900,
    submittedAt: daysAgo(6),
    slaDueAt: hoursFrom(daysAgo(6), svcSupplementFull.slaHours),
    attachFirstDoc: true,
    events: [
      {
        toState: RequestState.DRAFT,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: daysAgo(7),
      },
      {
        fromState: RequestState.DRAFT,
        toState: RequestState.SUBMITTED,
        actorUserId: alNoorOwner.id,
        actorRole: Role.CLIENT_OWNER,
        createdAt: daysAgo(6),
      },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: daysAgo(5),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.RETURNED_TO_CLIENT,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        reasonCode: ReturnReasonCode.LOW_RESOLUTION,
        faultAttribution: FaultAttribution.CLIENT_FAULT,
        note: "Artwork below 300 DPI — please re-upload carton panels.",
        createdAt: returnedB,
      },
    ],
    comments: [
      {
        authorUserId: intake.id,
        direction: CommentDirection.ATLAS_TO_CLIENT,
        reasonCode: ReturnReasonCode.LOW_RESOLUTION,
        bodyEn:
          "Please supply the carton artwork at 300 DPI minimum. Current files are ~120 DPI and text is not legible for SFDA review.",
        bodyAr:
          "يرجى تزويدنا بتصميم الكرتون بدقة 300 DPI كحد أدنى. الملفات الحالية حوالي 120 DPI والنص غير مقروء لمراجعة الهيئة.",
        createdAt: returnedB,
      },
    ],
  });

  // Push Al Noor over credit limit for admin finance tile
  await prisma.organisation.update({
    where: { id: alNoor.id },
    data: {
      creditLimit: new Prisma.Decimal(8000),
      autoHoldWhenOverLimit: true,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      organisationId: alNoor.id,
      entryDate: daysAgo(2),
      type: "ADJUSTMENT",
      referenceType: "Manual",
      referenceId: "demo-over-limit",
      debit: new Prisma.Decimal(12000),
      credit: 0,
      descriptionEn: "Demo adjustment — opens an overdue exposure for credit-limit testing",
      descriptionAr: "تسوية تجريبية — تفتح انكشافاً لاختبار حد الائتمان",
      createdByUserId: admin.id,
    },
  });

  // In-app notifications for admin + client
  const notifTargets = [
    {
      userId: admin.id,
      type: "REQUEST_SUBMITTED",
      titleEn: "New request in intake",
      titleAr: "طلب جديد في الاستلام",
      bodyEn: "ATL-2026-000409 awaits intake review (SLA at risk).",
      bodyAr: "ATL-2026-000409 بانتظار مراجعة الاستلام (مستوى الخدمة في خطر).",
      link: "/admin/requests",
    },
    {
      userId: intake.id,
      type: "REQUEST_SUBMITTED",
      titleEn: "Queue depth rising",
      titleAr: "ارتفاع عمق الطابور",
      bodyEn: "Several submissions are waiting in intake.",
      bodyAr: "عدة تقديمات بانتظار الاستلام.",
      link: "/admin/queues",
    },
    {
      userId: alNoorOwner.id,
      type: "REQUEST_RETURNED",
      titleEn: "Request returned",
      titleAr: "أُعيد الطلب",
      bodyEn: "ATL-2026-000412 needs higher-resolution artwork.",
      bodyAr: "ATL-2026-000412 يحتاج تصميماً بدقة أعلى.",
      link: "/client/requests",
    },
    {
      userId: alNoorOwner.id,
      type: "INVOICE_ISSUED",
      titleEn: "Invoice issued",
      titleAr: "صدرت فاتورة",
      bodyEn: "A new invoice was posted to your statement.",
      bodyAr: "أُضيفت فاتورة جديدة إلى كشف حسابك.",
      link: "/client/statement",
    },
  ];
  for (const n of notifTargets) {
    await prisma.notification.create({
      data: {
        userId: n.userId,
        type: n.type,
        titleEn: n.titleEn,
        titleAr: n.titleAr,
        bodyEn: n.bodyEn,
        bodyAr: n.bodyAr,
        link: n.link,
        createdAt: daysAgo(0),
      },
    });
  }

  // Backfill invoices/ledger for any later-seeded open requests still missing commerce
  const stillUnbilled = await prisma.request.findMany({
    where: {
      submittedAt: { not: null },
      state: { not: RequestState.DRAFT },
      invoices: { none: {} },
    },
  });
  for (const req of stillUnbilled) {
    const subtotal = req.priceCharged;
    const discount = req.discountApplied;
    const vat = subtotal.minus(discount).mul(0.15).toDecimalPlaces(2);
    const total = subtotal.minus(discount).plus(vat).toDecimalPlaces(2);
    const invoiceNo = `INV-2026-${String(invSeq).padStart(6, "0")}`;
    invSeq += 1;
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNo,
        organisationId: req.organisationId,
        requestId: req.id,
        subtotal,
        discount,
        vatAmount: vat,
        total,
        currency: "SAR",
        status: "ISSUED",
        issuedAt: req.submittedAt ?? daysAgo(1),
        dueAt: hoursFrom(req.submittedAt ?? daysAgo(1), 24 * 14),
        lines: {
          create: [
            {
              description: `${req.requestNo} · ${req.productNameEn}`,
              qty: 1,
              unitPrice: subtotal,
              lineTotal: subtotal,
            },
          ],
        },
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        organisationId: req.organisationId,
        entryDate: req.submittedAt ?? daysAgo(1),
        type: "INVOICE",
        referenceType: "Invoice",
        referenceId: invoice.id,
        debit: total,
        credit: 0,
        descriptionEn: `Invoice ${invoiceNo} for ${req.requestNo}`,
        descriptionAr: `فاتورة ${invoiceNo} للطلب ${req.requestNo}`,
        createdByUserId: req.createdByUserId,
      },
    });
  }

  const requestCount = await prisma.request.count();
  const invoiceCount = await prisma.invoice.count();
  const paymentCount = await prisma.payment.count();
  const ledgerCount = await prisma.ledgerEntry.count();

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        password: PASSWORD,
        admin: { email: "admin@atlas.com", password: ADMIN_PASSWORD },
        organisations: 3,
        users: 8,
        serviceItems: createdServiceItems.length,
        coupons: 3,
        requests: requestCount,
        invoices: invoiceCount,
        payments: paymentCount,
        ledgerEntries: ledgerCount,
        staff: {
          intake: intake.email,
          reviewer: reviewer.email,
          decision: decisionMaker.email,
          admin: admin.email,
        },
        tip: "Admin demo: ATLAS_DEMO_USER_EMAIL=admin@atlas.com · Client: owner@alnoorpharma.sa",
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
