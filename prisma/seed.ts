import {
  PrismaClient,
  Prisma,
  Role,
  RequestState,
  CommentDirection,
  ReturnReasonCode,
  FaultAttribution,
  CouponDiscountType,
  CouponAppliesTo,
  CouponClientScope,
  CouponStatus,
  OrganisationType,
  ClientCategory,
  DeliverableType,
  PlatformType,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { foodCheckSets } from "./seed-assets/sfda-checksets";

const prisma = new PrismaClient();

const UPLOAD_ROOT = path.join(process.cwd(), "storage", "uploads");

/** A minimal but valid single-page PDF used as a placeholder for seeded documents. */
const PLACEHOLDER_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 52>>stream\nBT /F1 16 Tf 20 60 Td (Atlas seed document) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Size 6/Root 1 0 R>>\n%%EOF",
  "utf8",
);

/** A simple square SVG logo placeholder carrying the organisation's initial. */
function placeholderLogoSvg(initial: string, color: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="${color}"/><text x="64" y="82" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#ffffff" text-anchor="middle">${initial}</text></svg>`,
    "utf8",
  );
}

/** Write a placeholder file (plus its mime sidecar) for a storage key, mirroring LocalFilesystemStorage. */
async function writeSeedFile(key: string, body: Buffer, mimeType: string) {
  const absolute = path.join(UPLOAD_ROOT, key);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body);
  await writeFile(`${absolute}.mime`, mimeType, "utf8");
}

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

type DocSeed = {
  code: string;
  nameEn: string;
  nameAr: string;
  mandatory: boolean;
  acceptedMimeTypes: string[];
  helpEn?: string | null;
  helpAr?: string | null;
  sortOrder: number;
};

async function main() {
  // Refuse to run against production — this wipes and reseeds demo data.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error(
      "Refusing to seed in production. Set ALLOW_PROD_SEED=1 only if you are certain.",
    );
  }

  // Wipe in dependency order for idempotent local reseeds. Deleting Request
  // cascades to RequestItem/RequestDocument/DocumentVersion/RequestEvent/
  // RequestComment/RequestCommentMention/RequestItemActivity/
  // ExternalDeliverable/RequestReopenRequest, so those don't need explicit
  // deleteMany calls. The catalogue (MainCategory/SubCategory/ServiceItem/
  // RequiredDocument) is rebuilt below to match the current reconciled
  // catalogue rather than left to migration state, so it's wiped too.
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
  await prisma.request.deleteMany();
  await prisma.engagement.deleteMany();
  await prisma.platformCredential.deleteMany();
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

  const [intake, evaluator, reviewer, decisionMaker, finance, catalogueManager, qualityManager, admin] =
    await Promise.all([
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
          email: "evaluator@atls.com.sa",
          username: "evaluator",
          passwordHash,
          fullNameEn: "Eng. Faisal Al-Dosari",
          fullNameAr: "م. فيصل الدوسري",
          phone: "+966501110005",
          locale: "ar",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          roles: { create: [{ role: Role.EVALUATOR }] },
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
          email: "finance@atls.com.sa",
          username: "atlas.finance",
          passwordHash,
          fullNameEn: "Turki Al-Shammari",
          fullNameAr: "تركي الشمري",
          phone: "+966501110006",
          locale: "ar",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          roles: { create: [{ role: Role.FINANCE }] },
        },
      }),
      prisma.user.create({
        data: {
          organisationId: atlas.id,
          email: "catalogue@atls.com.sa",
          username: "atlas.catalogue",
          passwordHash,
          fullNameEn: "Haifa Al-Rashidi",
          fullNameAr: "هيفاء الرشيدي",
          phone: "+966501110007",
          locale: "ar",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          roles: { create: [{ role: Role.CATALOGUE_MANAGER }] },
        },
      }),
      prisma.user.create({
        data: {
          organisationId: atlas.id,
          email: "quality@atls.com.sa",
          username: "atlas.quality",
          passwordHash,
          fullNameEn: "Majed Al-Ghamdi",
          fullNameAr: "ماجد الغامدي",
          phone: "+966501110008",
          locale: "ar",
          status: "ACTIVE",
          emailVerifiedAt: new Date(),
          roles: { create: [{ role: Role.QUALITY_MANAGER }] },
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
          roles: { create: [{ role: Role.SYSTEM_ADMIN }] },
        },
      }),
    ]);

  // ── Client organisations ─────────────────────────────────────────────────
  const alNoor = await prisma.organisation.create({
    data: {
      type: OrganisationType.CLIENT,
      clientCategory: ClientCategory.COMPANY,
      nameEn: "Al Noor Pharmaceuticals Co.",
      nameAr: "شركة النور للصناعات الدوائية",
      logoKey: "orgs/al-noor/logo.svg",
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
      clientCategory: ClientCategory.COMPANY,
      nameEn: "Gulf Beauty Trading LLC",
      nameAr: "الخليج لتجارة مستحضرات التجميل",
      logoKey: "orgs/gulf-beauty/logo.svg",
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

  const [alNoorOwner, alNoorAdmin, alNoorUser] = await Promise.all([
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
        email: "admin@alnoorpharma.sa",
        username: "alnoor.admin",
        passwordHash,
        fullNameEn: "Reem Al-Zahrani",
        fullNameAr: "ريم الزهراني",
        phone: "+966550010103",
        locale: "ar",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        roles: { create: [{ role: Role.CLIENT_ADMIN }] },
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

  // ── Catalogue: Food & Drugs (kept as-is — out of scope of the reconciliation) ──
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

  const [subSupplements, subGeneralFood, subNutrition, subClaims, subAdditives] = await Promise.all([
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

  // ── Catalogue: Cosmetics (reconciled: SFDA-COS-001..004) ────────────────────
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

  const subCosmeticLabelling = await prisma.subCategory.create({
    data: {
      mainCategoryId: cosmetics.id,
      code: "COSMETIC_LABELLING",
      nameEn: "Cosmetic Labelling",
      nameAr: "بطاقة مستحضرات التجميل",
      descEn: "Arabic/English cosmetic label assessment against GSO 1943 labelling articles.",
      descAr: "تقييم بطاقة مستحضر التجميل بالعربية والإنجليزية وفق مواد GSO 1943.",
      sortOrder: 1,
    },
  });

  const subCosmeticCertification = await prisma.subCategory.create({
    data: {
      mainCategoryId: cosmetics.id,
      code: "SFDA_CERTIFICATION",
      nameEn: "SFDA Certification",
      nameAr: "شهادات الهيئة",
      descEn:
        "SCOC issuance, GHAD product registration, and FASAH shipment certificate applications for cosmetics.",
      descAr: "إصدار شهادات المطابقة وتسجيل المنتجات في غد وطلبات شهادات فسح لمستحضرات التجميل.",
      sortOrder: 6,
    },
  });

  // ── Catalogue: SABER ──────────────────────────────────────────────────────
  const saber = await prisma.mainCategory.create({
    data: {
      code: "SABER",
      nameEn: "SABER",
      nameAr: "سابر",
      descEn: "Services related to the SABER platform and Saudi Technical Regulations.",
      descAr: "الخدمات المتعلقة بمنصة سابر واللوائح الفنية السعودية.",
      icon: "shield-check",
      sortOrder: 3,
      active: true,
    },
  });

  const [subSaberPcoc, subSaberScoc, subSaberAccountMgmt] = await Promise.all([
    prisma.subCategory.create({
      data: {
        mainCategoryId: saber.id,
        code: "PRODUCT_CERTIFICATION",
        nameEn: "Product Certification",
        nameAr: "شهادة مطابقة المنتج",
        descEn: "Product Certificate of Conformity (PCOC) issuance through the SABER platform.",
        descAr: "إصدار شهادة مطابقة المنتج (PCOC) من خلال منصة سابر.",
        sortOrder: 1,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: saber.id,
        code: "SHIPMENT_CERTIFICATION",
        nameEn: "Shipment Certification",
        nameAr: "شهادة مطابقة الإرسالية",
        descEn: "Shipment Certificate of Conformity (SCOC) issuance through the SABER platform.",
        descAr: "إصدار شهادة مطابقة إرسالية من خلال منصة سابر.",
        sortOrder: 2,
      },
    }),
    prisma.subCategory.create({
      data: {
        mainCategoryId: saber.id,
        code: "ACCOUNT_MANAGEMENT",
        nameEn: "Account Management",
        nameAr: "إدارة الحساب",
        descEn:
          "Ongoing management of the client's SABER account: registration, certificate applications, and follow-up.",
        descAr: "إدارة مستمرة لحساب العميل في سابر: التسجيل وطلبات الشهادات والمتابعة.",
        sortOrder: 3,
      },
    }),
  ]);

  // ── Catalogue: Testing Coordination ──────────────────────────────────────
  const testingCoordination = await prisma.mainCategory.create({
    data: {
      code: "TESTING_COORDINATION",
      nameEn: "Testing Coordination",
      nameAr: "تنسيق الاختبارات المخبرية",
      descEn: "Services related to laboratory testing and coordination with accredited laboratories.",
      descAr: "الخدمات المتعلقة بتنسيق الاختبارات مع المختبرات المعتمدة.",
      icon: "flask-conical",
      sortOrder: 4,
      active: true,
    },
  });

  const subLabTestingCoordination = await prisma.subCategory.create({
    data: {
      mainCategoryId: testingCoordination.id,
      code: "LABORATORY_TESTING_COORDINATION",
      nameEn: "Laboratory Testing Coordination",
      nameAr: "تنسيق الاختبارات المخبرية",
      descEn: "Coordination of product testing with accredited third-party laboratories.",
      descAr: "تنسيق اختبارات المنتجات مع مختبرات خارجية معتمدة.",
      sortOrder: 1,
    },
  });

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
    deliverableEn?: string;
    deliverableAr?: string;
    deliverableType?: DeliverableType;
    requiredCredentialPlatform?: PlatformType | null;
    defaultEvaluatorId?: string | null;
    requiresInspection?: boolean;
    requiresLabTesting?: boolean;
    requiresFactoryAudit?: boolean;
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
        deliverableEn: input.deliverableEn,
        deliverableAr: input.deliverableAr,
        deliverableType: input.deliverableType ?? DeliverableType.INTERNAL_REPORT,
        requiredCredentialPlatform: input.requiredCredentialPlatform ?? null,
        defaultEvaluatorId: input.defaultEvaluatorId ?? null,
        requiresInspection: input.requiresInspection ?? false,
        requiresLabTesting: input.requiresLabTesting ?? false,
        requiresFactoryAudit: input.requiresFactoryAudit ?? false,
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
            helpEn: d.helpEn ?? null,
            helpAr: d.helpAr ?? null,
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

  // foodCheckSets (5 sections, 113 SFDA verification items with full knowledge base)
  // is imported from ./seed-assets/sfda-checksets — generated from the SFDA workbook.

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
    helpAr: "أدرج جميع المكونات بكمياتها ووحداتها كما تُصرَّح للهيئة.",
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

  const foodServiceItemSeeds = [
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
  ] as const;

  const createdFoodItems = [];
  for (const seed of foodServiceItemSeeds) {
    createdFoodItems.push(
      await createServiceItem({
        ...seed,
        docs: [...seed.docs],
        productAttrSchema: foodSupplementAttrs,
        checkSets: foodCheckSets as unknown as Prisma.InputJsonValue,
      }),
    );
  }

  // ── Reconciled Cosmetics services (SFDA-COS-001..004) ────────────────────
  const svcCosLabelAssessment = await createServiceItem({
    subCategoryId: subCosmeticLabelling.id,
    code: "SFDA-COS-001",
    nameEn: "Technical Label Assessment",
    nameAr: "التقييم الفني لملصق المنتج",
    descEn:
      "Technical assessment of cosmetic product labeling to verify compliance with SFDA regulations and applicable Gulf standards.",
    descAr: "تقييم فني لملصق المنتج التجميلي للتحقق من مطابقته لمتطلبات الهيئة العامة للغذاء والدواء والمواصفات الخليجية.",
    basePrice: 1500,
    slaHours: 72,
    sortOrder: 2,
    docs: [
      {
        code: "PRODUCT_ARTWORK",
        nameEn: "Product artwork",
        nameAr: "تصميم المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        sortOrder: 1,
      },
      {
        code: "INGREDIENT_LIST_INCI",
        nameEn: "Ingredient list (INCI)",
        nameAr: "قائمة المكونات (INCI)",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 2,
      },
    ],
    // product_name/brand_name are intentionally omitted here — they'd
    // duplicate the wizard's built-in productNameEn/productNameAr and brand
    // fields, which every service already collects.
    productAttrSchema: {
      type: "object",
      required: ["client_name"],
      properties: {
        client_name: { type: "string", titleEn: "Client name", titleAr: "اسم العميل" },
      },
    },
    checkSets: [{ code: "GSO_1943", titleEn: "GSO 1943 — Cosmetic labelling", titleAr: "GSO 1943 — بطاقة مستحضرات التجميل" }],
    deliverableEn: "Technical Label Assessment Report",
    deliverableAr: "تقرير التقييم الفني للملصق",
    deliverableType: DeliverableType.INTERNAL_REPORT,
    requiredCredentialPlatform: null,
    defaultEvaluatorId: evaluator.id,
  });

  const svcCosScoc = await createServiceItem({
    subCategoryId: subCosmeticCertification.id,
    code: "SFDA-COS-002",
    nameEn: "Cosmetic Shipment Certificate of Conformity (SCOC)",
    nameAr: "شهادة مطابقة إرسالية لمستحضرات التجميل",
    descEn: "Issuance of a Shipment Certificate of Conformity (SCOC) after completing the conformity assessment process.",
    descAr: "إصدار شهادة مطابقة إرسالية لمستحضرات التجميل بعد استكمال إجراءات تقييم المطابقة.",
    basePrice: 1200,
    slaHours: 48,
    sortOrder: 1,
    docs: [
      {
        code: "PRODUCT_ARTWORK",
        nameEn: "Product artwork",
        nameAr: "تصميم المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        sortOrder: 1,
      },
      {
        code: "INGREDIENT_LIST",
        nameEn: "Ingredient list",
        nameAr: "قائمة المكونات",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 2,
      },
      {
        code: "COMMERCIAL_INVOICE_BATCH",
        nameEn: "Commercial invoice with batch number",
        nameAr: "الفاتورة التجارية مع رقم الدفعة",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 3,
      },
      {
        code: "PACKING_LIST",
        nameEn: "Packing list",
        nameAr: "قائمة التعبئة",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 4,
      },
    ],
    productAttrSchema: {
      type: "object",
      required: ["faseh_request_no", "importer", "country_of_origin"],
      properties: {
        faseh_request_no: { type: "string", titleEn: "FASEH request #", titleAr: "رقم طلب فسح" },
        importer: { type: "string", titleEn: "Importer", titleAr: "المستورد" },
        country_of_origin: { type: "string", titleEn: "Country of origin", titleAr: "بلد المنشأ" },
      },
    },
    checkSets: [],
    deliverableEn: "Shipment Certificate of Conformity (SCOC)",
    deliverableAr: "شهادة مطابقة إرسالية",
    deliverableType: DeliverableType.EXTERNAL_CERTIFICATE,
    requiredCredentialPlatform: null,
  });

  const svcCosGhadRegistration = await createServiceItem({
    subCategoryId: subCosmeticCertification.id,
    code: "SFDA-COS-003",
    nameEn: "GHAD Product Registration",
    nameAr: "تسجيل المنتجات في نظام غد",
    descEn: "Registration of cosmetic products in the SFDA GHAD system and follow-up until approval.",
    descAr: "تسجيل المنتجات التجميلية في نظام غد ومتابعة الطلب حتى اكتمال إجراءات التسجيل.",
    basePrice: 2000,
    slaHours: 240,
    sortOrder: 2,
    docs: [
      {
        code: "PRODUCT_ARTWORK",
        nameEn: "Product artwork",
        nameAr: "تصميم المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        sortOrder: 1,
      },
      {
        code: "INGREDIENT_LIST",
        nameEn: "Ingredient list",
        nameAr: "قائمة المكونات",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 2,
      },
      {
        code: "PRODUCT_IMAGES",
        nameEn: "Product images",
        nameAr: "صور المنتج",
        mandatory: true,
        acceptedMimeTypes: ["image/png", "image/jpeg"],
        sortOrder: 3,
      },
      {
        code: "AUTHORIZATION_LETTER",
        nameEn: "Authorization letter",
        nameAr: "خطاب تفويض",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 4,
      },
    ],
    productAttrSchema: {
      type: "object",
      required: ["client_name"],
      properties: { client_name: { type: "string", titleEn: "Client name", titleAr: "اسم العميل" } },
    },
    checkSets: [],
    deliverableEn: "Certificate for Cosmetic Product Notification",
    deliverableAr: "شهادة إخطار المنتج التجميلي",
    deliverableType: DeliverableType.EXTERNAL_CERTIFICATE,
    requiredCredentialPlatform: PlatformType.GHAD,
  });

  const svcCosFasahCert = await createServiceItem({
    subCategoryId: subCosmeticCertification.id,
    code: "SFDA-COS-004",
    nameEn: "FASAH Shipment Certificate Application",
    nameAr: "رفع طلب شهادة المطابقة عبر منصة فسح",
    descEn: "Submission and follow-up of cosmetic shipment certificate applications through the FASAH platform.",
    descAr: "رفع ومتابعة طلب شهادة مطابقة الإرسالية عبر منصة فسح.",
    basePrice: 1000,
    slaHours: 48,
    sortOrder: 3,
    docs: [
      {
        code: "COMMERCIAL_INVOICE",
        nameEn: "Commercial invoice",
        nameAr: "الفاتورة التجارية",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 1,
      },
      {
        code: "PACKING_LIST",
        nameEn: "Packing list",
        nameAr: "قائمة التعبئة",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 2,
      },
      {
        code: "BILL_OF_LADING_AWB",
        nameEn: "Bill of lading / air waybill",
        nameAr: "بوليصة الشحن / بوليصة الشحن الجوي",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 3,
      },
    ],
    productAttrSchema: {
      type: "object",
      required: ["product_notification_number", "importer_information", "port_of_entry"],
      properties: {
        product_notification_number: { type: "string", titleEn: "Product notification number", titleAr: "رقم إخطار المنتج" },
        importer_information: { type: "string", titleEn: "Importer information", titleAr: "معلومات المستورد" },
        port_of_entry: { type: "string", titleEn: "Port of entry", titleAr: "منفذ الدخول" },
      },
    },
    checkSets: [],
    deliverableEn: "FASEH Request #",
    deliverableAr: "رقم طلب فسح",
    deliverableType: DeliverableType.EXTERNAL_CERTIFICATE,
    requiredCredentialPlatform: PlatformType.GHAD,
  });

  // ── SABER services (SAB-001..003) ────────────────────────────────────────
  const saberTechnicalRegulationEnum = [
    "TEXTILE",
    "ORNAMENTS_ACCESSORIES",
    "PAPER_CARDBOARD",
    "PACKAGING",
    "MACHINERY_SAFETY",
    "KITCHEN_TOOLS_FOOD_SAFETY",
    "ICT_DEVICES",
    "BUILDING_MATERIALS_PART5",
    "BUILDING_MATERIALS_PART4",
    "BUILDING_MATERIALS_PART1",
    "LOW_VOLTAGE_ELECTRICAL",
  ] as const;

  const svcSaberPcoc = await createServiceItem({
    subCategoryId: subSaberPcoc.id,
    code: "SAB-001",
    nameEn: "Product Certificate of Conformity (PCOC)",
    nameAr: "شهادة مطابقة منتج",
    descEn: "Issuance of a Product Certificate of Conformity (PCOC) through the SABER platform.",
    descAr: "إصدار شهادة مطابقة منتج من خلال منصة سابر.",
    basePrice: 2800,
    slaHours: 120,
    sortOrder: 1,
    docs: [
      {
        code: "IMPORTER_DECLARATION",
        nameEn: "Importer declaration",
        nameAr: "إقرار المستورد",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        helpEn:
          "Download the template, fill it out on your Importer Header Letter, then upload the completed file.",
        helpAr:
          "نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.",
        sortOrder: 1,
      },
      {
        code: "MANUFACTURER_DECLARATION",
        nameEn: "Manufacturer declaration",
        nameAr: "إقرار المصنّع",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        helpEn:
          "Download the template, fill it out on your Importer Header Letter, then upload the completed file.",
        helpAr:
          "نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.",
        sortOrder: 2,
      },
      {
        code: "TEST_REPORT",
        nameEn: "Test report",
        nameAr: "تقرير الاختبار",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 3,
      },
      {
        code: "PRODUCT_IMAGES",
        nameEn: "Product images",
        nameAr: "صور المنتج",
        mandatory: true,
        acceptedMimeTypes: ["image/png", "image/jpeg"],
        sortOrder: 4,
      },
      {
        code: "PRODUCT_LABEL",
        nameEn: "Product label",
        nameAr: "بطاقة المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf", "image/png", "image/jpeg"],
        sortOrder: 5,
      },
      {
        code: "RISK_ASSESSMENT",
        nameEn: "Risk assessment",
        nameAr: "تقييم المخاطر",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        helpEn:
          "Download the template, fill it out on your Importer Header Letter, then upload the completed file.",
        helpAr:
          "نزّل النموذج، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف المكتمل.",
        sortOrder: 6,
      },
    ],
    // Reconciled per migration 20260806053000: product_name dropped (already
    // collected via RequestItem.productNameEn/Ar in the same wizard step).
    // Reconciled per migration 20260817120000: product_category dropped (the
    // mandatory PRODUCT_IMAGES doc above already covers it); hs_code,
    // manufacturer and technical_regulation relaxed to optional; added the
    // optional saber_request_number for clients who already started on SABER.
    productAttrSchema: {
      type: "object",
      required: ["country_of_origin"],
      properties: {
        hs_code: { type: "string", titleEn: "HS code", titleAr: "الرمز الجمركي" },
        manufacturer: { type: "string", titleEn: "Manufacturer", titleAr: "الشركة المصنعة" },
        country_of_origin: { type: "string", titleEn: "Country of origin", titleAr: "بلد المنشأ" },
        technical_regulation: {
          type: "string",
          enum: saberTechnicalRegulationEnum,
          titleEn: "Technical regulation",
          titleAr: "اللائحة الفنية",
          helpEn:
            "Textile Products; Ornaments and Accessories; Paper and Cardboard; Packaging; General Requirements for Machinery Safety; Food Safety in Kitchen Tools and Appliances; Communications and ICT Devices; Building Materials Part 5/4/1; GCC Low Voltage Electrical Equipment and Appliances.",
          helpAr:
            "المنسوجات؛ الحلي والإكسسوارات؛ الورق والكرتون؛ التغليف؛ السلامة العامة للآلات؛ سلامة أدوات وأجهزة المطبخ؛ أجهزة الاتصالات وتقنية المعلومات؛ مواد البناء الجزء 5/4/1؛ الأجهزة الكهربائية منخفضة الجهد.",
        },
        saber_request_number: {
          type: "string",
          titleEn: "SABER request number",
          titleAr: "رقم طلب سابر",
          helpEn: "If you already started this request on the SABER platform, enter its request number.",
          helpAr: "إذا كنت قد بدأت هذا الطلب بالفعل على منصة سابر، فأدخل رقم الطلب.",
        },
      },
    },
    checkSets: [{ code: "SABER_TECH_REG", titleEn: "Applicable technical regulation", titleAr: "اللائحة الفنية المعنية" }],
    deliverableEn: "Product Certificate of Conformity (PCOC)",
    deliverableAr: "شهادة مطابقة منتج (PCOC)",
    // INTERNAL_REPORT per migration 20260817150000: the External submission
    // panel (and the certificate-attachment requirement to close) no longer
    // applies to PCOC.
    deliverableType: DeliverableType.INTERNAL_REPORT,
    requiredCredentialPlatform: PlatformType.SABER,
    defaultEvaluatorId: evaluator.id,
  });

  const svcSaberScoc = await createServiceItem({
    subCategoryId: subSaberScoc.id,
    code: "SAB-002",
    nameEn: "Shipment Certificate of Conformity (SCOC)",
    nameAr: "شهادة مطابقة إرسالية",
    descEn: "Issuance of a Shipment Certificate of Conformity through the SABER platform.",
    descAr: "إصدار شهادة مطابقة إرسالية من خلال منصة سابر.",
    basePrice: 1200,
    slaHours: 48,
    sortOrder: 2,
    docs: [
      {
        code: "COMMERCIAL_INVOICE",
        nameEn: "Commercial invoice",
        nameAr: "الفاتورة التجارية",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 1,
      },
      {
        code: "PACKING_LIST",
        nameEn: "Packing list",
        nameAr: "قائمة التعبئة",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 2,
      },
      {
        code: "PRODUCT_CERTIFICATE",
        nameEn: "Product certificate (PCOC)",
        nameAr: "شهادة مطابقة المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 3,
      },
    ],
    // Reconciled per migration 20260817160000: shipment certificates need the
    // SABER shipment request number plus one PCOC certificate number per
    // product in the shipment, each matched to the model(s) it covers.
    productAttrSchema: {
      type: "object",
      required: ["shipment_details", "importer_information", "saber_request_number", "product_certificates"],
      properties: {
        shipment_details: { type: "string", sortOrder: 1, titleEn: "Shipment details", titleAr: "تفاصيل الإرسالية" },
        importer_information: { type: "string", sortOrder: 2, titleEn: "Importer information", titleAr: "معلومات المستورد" },
        saber_request_number: {
          type: "string",
          sortOrder: 3,
          titleEn: "Request number in SABER",
          titleAr: "رقم الطلب في سابر",
          helpEn: "The request number for this shipment on the SABER platform.",
          helpAr: "رقم هذا الطلب الخاص بالإرسالية على منصة سابر.",
        },
        product_certificates: {
          type: "array",
          sortOrder: 4,
          titleEn: "Product certificates (PCOC)",
          titleAr: "شهادات مطابقة المنتج (PCOC)",
          helpEn: "Add one entry per product in the shipment: its PCOC certificate number and the model(s) it covers.",
          helpAr: "أضف إدخالاً لكل منتج في الإرسالية: رقم شهادة مطابقة المنتج (PCOC) والموديل/الموديلات التي يغطيها.",
          items: {
            type: "object",
            required: ["certificate_number", "models"],
            properties: {
              certificate_number: { type: "string", sortOrder: 1, titleEn: "PCOC certificate number", titleAr: "رقم شهادة المطابقة" },
              models: { type: "string", sortOrder: 2, titleEn: "Model(s) covered", titleAr: "الموديل/الموديلات المشمولة" },
            },
          },
        },
      },
    },
    checkSets: [],
    deliverableEn: "Shipment Certificate of Conformity",
    deliverableAr: "شهادة مطابقة إرسالية",
    deliverableType: DeliverableType.EXTERNAL_CERTIFICATE,
    requiredCredentialPlatform: PlatformType.SABER,
  });

  const svcSaberAccountMgmt = await createServiceItem({
    subCategoryId: subSaberAccountMgmt.id,
    code: "SAB-003",
    nameEn: "SABER Account Management",
    nameAr: "إدارة حساب سابر",
    descEn:
      "Complete management of the customer's SABER account, including technical file preparation, product registration, submission of Product and Shipment Certificate applications, and follow-up until completion.",
    descAr:
      "إدارة حساب العميل في منصة سابر، وتشمل تجهيز الملف الفني، وتسجيل المنتجات، ورفع طلبات شهادات مطابقة المنتجات والإرساليات، ومتابعة جميع الطلبات حتى اكتمالها.",
    basePrice: 6000,
    slaHours: 720,
    sortOrder: 3,
    docs: [
      {
        code: "PRODUCT_INFORMATION",
        nameEn: "Product information",
        nameAr: "معلومات المنتج",
        mandatory: true,
        acceptedMimeTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
        sortOrder: 1,
      },
    ],
    productAttrSchema: {
      type: "object",
      required: ["saber_login_email", "company_name", "cr_number"],
      properties: {
        saber_login_email: { type: "string", titleEn: "SABER login email", titleAr: "البريد الإلكتروني لحساب سابر" },
        company_name: { type: "string", titleEn: "Company name", titleAr: "اسم الشركة" },
        cr_number: { type: "string", titleEn: "Commercial registration number", titleAr: "رقم السجل التجاري" },
      },
    },
    checkSets: [],
    deliverableEn: "Completed Requested Service",
    deliverableAr: "إنجاز الخدمة المطلوبة",
    deliverableType: DeliverableType.INTERNAL_REPORT,
    requiredCredentialPlatform: PlatformType.SABER,
  });

  // ── Testing Coordination (LAB-001) ───────────────────────────────────────
  const svcLabTesting = await createServiceItem({
    subCategoryId: subLabTestingCoordination.id,
    code: "LAB-001",
    nameEn: "Laboratory Testing Coordination",
    nameAr: "تنسيق الاختبارات المخبرية",
    descEn: "Management and coordination of laboratory testing with accredited laboratories.",
    descAr: "إدارة وتنسيق الاختبارات المخبرية مع المختبرات المعتمدة.",
    basePrice: 800,
    slaHours: 168,
    sortOrder: 1,
    docs: [
      {
        code: "PRODUCT_SPECIFICATION",
        nameEn: "Product specification (if available)",
        nameAr: "مواصفات المنتج (إن وجدت)",
        mandatory: false,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 1,
      },
      {
        code: "PRODUCT_IMAGES",
        nameEn: "Product images",
        nameAr: "صور المنتج",
        mandatory: true,
        acceptedMimeTypes: ["image/png", "image/jpeg"],
        sortOrder: 2,
      },
      {
        code: "TECHNICAL_DATASHEET",
        nameEn: "Technical datasheet (if available)",
        nameAr: "النشرة الفنية (إن وجدت)",
        mandatory: false,
        acceptedMimeTypes: ["application/pdf"],
        sortOrder: 3,
      },
    ],
    // Reconciled per migration 20260806053000: product_name dropped.
    productAttrSchema: {
      type: "object",
      required: [],
      properties: {
        required_standard: { type: "string", titleEn: "Required standard (if known)", titleAr: "المواصفة المطلوبة (إن وجدت)" },
        required_tests: {
          type: "string",
          titleEn: "Required tests (if specific tests are needed)",
          titleAr: "الاختبارات المطلوبة (إن وجدت اختبارات محددة)",
        },
      },
    },
    checkSets: [],
    deliverableEn: "Laboratory Test Report",
    deliverableAr: "تقرير الاختبار المخبري",
    deliverableType: DeliverableType.EXTERNAL_CERTIFICATE,
    requiredCredentialPlatform: null,
    // The whole point of this service is coordinating lab testing, so the
    // Evaluation-stage Laboratory Testing activity panel (schedule/upload
    // reports/complete) must be available on every request for it.
    requiresLabTesting: true,
  });

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

  // ── Helper: request with items / events / comments / docs ────────────────
  type ItemInput = {
    serviceItem: { id: string; basePrice: Prisma.Decimal; vatRate: Prisma.Decimal; requiredDocuments: { id: string; nameEn: string }[] };
    productNameEn: string;
    productNameAr: string;
    brand?: string;
    productAttrs: Prisma.InputJsonValue;
    basePrice?: number;
    vatRate?: number;
  };

  async function seedRequest(opts: {
    requestNo: string;
    organisationId: string;
    createdByUserId: string;
    assignedToUserId?: string;
    state: RequestState;
    items: ItemInput[];
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
      reasonCodes?: ReturnReasonCode[];
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
        createdByUserId: opts.createdByUserId,
        assignedToUserId: opts.assignedToUserId,
        state: opts.state,
        heldFromState: opts.heldFromState,
        submissionNo: opts.submissionNo,
        priceCharged: price,
        discountApplied: discount,
        couponCode: opts.couponCode,
        submittedAt: opts.submittedAt,
        closedAt: opts.closedAt,
        slaDueAt: opts.slaDueAt,
        items: {
          create: opts.items.map((it, idx) => ({
            serviceItemId: it.serviceItem.id,
            productNameEn: it.productNameEn,
            productNameAr: it.productNameAr,
            brand: it.brand,
            productAttrs: it.productAttrs,
            basePrice: new Prisma.Decimal(it.basePrice ?? it.serviceItem.basePrice),
            vatRate: new Prisma.Decimal(it.vatRate ?? it.serviceItem.vatRate),
            sortOrder: idx,
          })),
        },
      },
      include: { items: true },
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
          reasonCodes: event.reasonCodes ?? [],
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

    if (opts.attachFirstDoc && opts.items[0] && opts.items[0].serviceItem.requiredDocuments[0]) {
      const firstItem = request.items[0];
      const required = opts.items[0].serviceItem.requiredDocuments[0];
      const doc = await prisma.requestDocument.create({
        data: {
          requestId: request.id,
          requestItemId: firstItem.id,
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
    createdByUserId: alNoorUser.id,
    state: RequestState.DRAFT,
    items: [
      {
        serviceItem: svcSupplementFull(),
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
      },
    ],
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

  function svcSupplementFull() {
    return createdFoodItems.find((i) => i.code === "SUPPLEMENT_LABEL_FULL")!;
  }
  function svcNutrition() {
    return createdFoodItems.find((i) => i.code === "NUTRITION_FACTS_VERIFY")!;
  }
  function svcClaimsFull() {
    return createdFoodItems.find((i) => i.code === "CLAIMS_SUBSTANTIATION")!;
  }

  // 2) UNDER_INTAKE_REVIEW — Al Noor
  const submitted2 = daysAgo(5);
  await seedRequest({
    requestNo: "ATL-2026-000402",
    organisationId: alNoor.id,
    createdByUserId: alNoorUser.id,
    assignedToUserId: intake.id,
    state: RequestState.UNDER_INTAKE_REVIEW,
    items: [
      {
        serviceItem: svcNutrition(),
        productNameEn: "Date Protein Bar 40 g",
        productNameAr: "بار بروتين التمر 40 غرام",
        brand: "Oasis Fuel",
        productAttrs: { dosage_form: "bar", has_nutrition_claim: true, has_health_claim: false },
      },
    ],
    submissionNo: 1,
    priceCharged: 2200,
    submittedAt: submitted2,
    slaDueAt: hoursFrom(submitted2, Number(svcNutrition().slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(6) },
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
    createdByUserId: alNoorOwner.id,
    assignedToUserId: intake.id,
    state: RequestState.RETURNED_TO_CLIENT,
    items: [
      {
        serviceItem: svcSupplementFull(),
        productNameEn: "Omega-3 Softgels 1000 mg",
        productNameAr: "أوميغا-3 سوفتجل 1000 ملغ",
        brand: "Al Noor Marine",
        productAttrs: { dosage_form: "softgel", contains_fish_oil: true, target_group: "adult", has_health_claim: true, has_nutrition_claim: false },
      },
    ],
    submissionNo: 1,
    priceCharged: 4500,
    discountApplied: 500,
    couponCode: couponAtlas500.code,
    submittedAt: submitted3,
    slaDueAt: hoursFrom(submitted3, Number(svcSupplementFull().slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(13) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: submitted3 },
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
        reasonCodes: [ReturnReasonCode.MISSING_ARTWORK],
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

  // 4) Resubmission at 50% — same product, submissionNo 2, TECHNICAL_REVIEW
  const submitted4 = daysAgo(7);
  await seedRequest({
    requestNo: "ATL-2026-000404",
    organisationId: alNoor.id,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: reviewer.id,
    state: RequestState.TECHNICAL_REVIEW,
    items: [
      {
        serviceItem: svcSupplementFull(),
        productNameEn: "Omega-3 Softgels 1000 mg",
        productNameAr: "أوميغا-3 سوفتجل 1000 ملغ",
        brand: "Al Noor Marine",
        productAttrs: {
          dosage_form: "softgel",
          contains_fish_oil: true,
          target_group: "adult",
          has_health_claim: true,
          has_nutrition_claim: false,
          prior_request_no: "ATL-2026-000403",
        },
        basePrice: 2250,
      },
    ],
    submissionNo: 2,
    priceCharged: 2250,
    submittedAt: submitted4,
    slaDueAt: hoursFrom(submitted4, Number(svcSupplementFull().slaHours)),
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
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: submitted4 },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(submitted4, 7),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
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
    createdByUserId: alNoorUser.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.REPORT_ISSUED,
    items: [
      {
        serviceItem: svcClaimsFull(),
        productNameEn: "Vitamin D3 5000 IU Tablets",
        productNameAr: "أقراص فيتامين د3 5000 وحدة دولية",
        brand: "Al Noor Vita",
        productAttrs: { dosage_form: "tablet", target_group: "adult", has_health_claim: true, has_nutrition_claim: true, contains_fish_oil: false },
      },
    ],
    submissionNo: 1,
    priceCharged: 3500,
    submittedAt: submitted5,
    slaDueAt: hoursFrom(submitted5, Number(svcClaimsFull().slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(42) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorUser.id, actorRole: Role.CLIENT_USER, createdAt: submitted5 },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(submitted5, 12),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
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
        bodyEn: "Report issued. Executive Summary and Detailed Findings are available for download. Verify at /verify/ATL-2026-000405.",
        bodyAr: "صدر التقرير. الملخص التنفيذي والتقرير التفصيلي متاحان للتحميل. تحقق عبر /verify/ATL-2026-000405.",
        createdAt: issued5,
      },
    ],
  });

  // 6) ASSESSMENT_RUNNING — Gulf Beauty cosmetic label
  const submitted6 = daysAgo(3);
  await seedRequest({
    requestNo: "ATL-2026-000406",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfUser.id,
    assignedToUserId: evaluator.id,
    state: RequestState.ASSESSMENT_RUNNING,
    items: [
      {
        serviceItem: svcCosLabelAssessment,
        productNameEn: "Hyaluronic Hydra Serum 30 ml",
        productNameAr: "سيروم الهيالورونيك المرطب 30 مل",
        brand: "Gulf Glow",
        productAttrs: { product_name: "Hyaluronic Hydra Serum 30 ml", brand_name: "Gulf Glow", client_name: "Gulf Beauty Trading LLC" },
      },
    ],
    submissionNo: 1,
    priceCharged: 1500,
    discountApplied: 150,
    couponCode: couponCosmetic10.code,
    submittedAt: submitted6,
    slaDueAt: hoursFrom(submitted6, Number(svcCosLabelAssessment.slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(4) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: submitted6 },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        note: "Auto-routed to default Evaluator for Technical Label Assessment",
        createdAt: hoursFrom(submitted6, 10),
      },
    ],
  });

  const req406 = await prisma.request.findUniqueOrThrow({ where: { requestNo: "ATL-2026-000406" } });
  await prisma.couponRedemption.create({
    data: {
      couponId: couponCosmetic10.id,
      organisationId: gulfBeauty.id,
      requestId: req406.id,
      discountApplied: new Prisma.Decimal(150),
      redeemedAt: submitted6,
    },
  });
  await prisma.coupon.update({ where: { id: couponCosmetic10.id }, data: { usedCount: 1 } });

  // 7) CLOSED — Gulf Beauty cosmetic SCOC
  const submitted7 = daysAgo(60);
  const closed7 = daysAgo(45);
  await seedRequest({
    requestNo: "ATL-2026-000407",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfOwner.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.CLOSED,
    items: [
      {
        serviceItem: svcCosScoc,
        productNameEn: "Mineral Sunscreen SPF 50",
        productNameAr: "واقي شمس معدني عامل حماية 50",
        brand: "Gulf Glow",
        productAttrs: { faseh_request_no: "FASEH-2025-88213", importer: "Gulf Beauty Trading LLC", country_of_origin: "France" },
      },
    ],
    submissionNo: 1,
    priceCharged: 1200,
    submittedAt: submitted7,
    closedAt: closed7,
    slaDueAt: hoursFrom(submitted7, Number(svcCosScoc.slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(62) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: submitted7 },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(submitted7, 11),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
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

  // 8) ON_HOLD — Gulf Beauty GHAD product registration
  const submitted8 = daysAgo(9);
  await seedRequest({
    requestNo: "ATL-2026-000408",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfUser.id,
    assignedToUserId: intake.id,
    state: RequestState.ON_HOLD,
    heldFromState: RequestState.UNDER_INTAKE_REVIEW,
    items: [
      {
        serviceItem: svcCosGhadRegistration,
        productNameEn: "Rose Clay Face Mask 50 ml",
        productNameAr: "قناع الطين الوردي للوجه 50 مل",
        brand: "Gulf Glow",
        productAttrs: { client_name: "Gulf Beauty Trading LLC" },
      },
    ],
    submissionNo: 1,
    priceCharged: 2000,
    submittedAt: submitted8,
    slaDueAt: hoursFrom(submitted8, Number(svcCosGhadRegistration.slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(10) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: submitted8 },
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
        reasonCodes: [ReturnReasonCode.EXPIRED_DOCUMENT],
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

  // 9) SUBMITTED — Al Noor (SLA at risk demo)
  const slaRiskSubmit = daysAgo(4);
  await seedRequest({
    requestNo: "ATL-2026-000409",
    organisationId: alNoor.id,
    createdByUserId: alNoorUser.id,
    assignedToUserId: intake.id,
    state: RequestState.SUBMITTED,
    items: [
      {
        serviceItem: svcSupplementFull(),
        productNameEn: "Vitamin D3 Drops 400 IU",
        productNameAr: "نقط فيتامين د3 400 وحدة",
        brand: "Al Noor Kids",
        productAttrs: {
          dosage_form: "liquid",
          target_group: "child",
          contains_fish_oil: false,
          has_nutrition_claim: false,
          has_health_claim: false,
        },
      },
    ],
    submissionNo: 1,
    priceCharged: 3200,
    submittedAt: slaRiskSubmit,
    slaDueAt: hoursFrom(slaRiskSubmit, 24),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(5) },
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

  // 10) TECHNICAL_REVIEW — Gulf Beauty cosmetic label
  const techSubmit = daysAgo(9);
  await seedRequest({
    requestNo: "ATL-2026-000410",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfUser.id,
    assignedToUserId: reviewer.id,
    state: RequestState.TECHNICAL_REVIEW,
    items: [
      {
        serviceItem: svcCosLabelAssessment,
        productNameEn: "Niacinamide Serum 10%",
        productNameAr: "سيروم نياسيناميد 10٪",
        brand: "Gulf Glow",
        productAttrs: { product_name: "Niacinamide Serum 10%", brand_name: "Gulf Glow", client_name: "Gulf Beauty Trading LLC" },
      },
    ],
    submissionNo: 1,
    priceCharged: 1500,
    submittedAt: techSubmit,
    slaDueAt: hoursFrom(techSubmit, Number(svcCosLabelAssessment.slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(10) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: techSubmit },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(techSubmit, 30),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(techSubmit, 50),
      },
    ],
  });

  // 11) DECISION — Al Noor
  const decisionSubmit = daysAgo(11);
  await seedRequest({
    requestNo: "ATL-2026-000411",
    organisationId: alNoor.id,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: decisionMaker.id,
    state: RequestState.DECISION,
    items: [
      {
        serviceItem: svcNutrition(),
        productNameEn: "Whey Isolate Vanilla 1 kg",
        productNameAr: "واي عازل فانيلا 1 كغ",
        brand: "Al Noor Sport",
        productAttrs: { dosage_form: "powder", has_nutrition_claim: true, target_group: "athlete", contains_fish_oil: false, has_health_claim: false },
      },
    ],
    submissionNo: 1,
    priceCharged: 4100,
    submittedAt: decisionSubmit,
    slaDueAt: hoursFrom(decisionSubmit, Number(svcNutrition().slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(12) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: decisionSubmit },
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
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
        createdAt: hoursFrom(decisionSubmit, 20),
      },
      {
        fromState: RequestState.ASSESSMENT_RUNNING,
        toState: RequestState.TECHNICAL_REVIEW,
        actorUserId: evaluator.id,
        actorRole: Role.EVALUATOR,
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

  // 12) RETURNED_TO_CLIENT — Al Noor (second, different reason)
  const returnedB = daysAgo(3);
  await seedRequest({
    requestNo: "ATL-2026-000412",
    organisationId: alNoor.id,
    createdByUserId: alNoorOwner.id,
    assignedToUserId: intake.id,
    state: RequestState.RETURNED_TO_CLIENT,
    items: [
      {
        serviceItem: svcSupplementFull(),
        productNameEn: "Collagen Peptides Unflavoured",
        productNameAr: "ببتيدات الكولاجين بدون نكهة",
        brand: "Al Noor Beauty In",
        productAttrs: { dosage_form: "powder", target_group: "adult", contains_fish_oil: false, has_nutrition_claim: false, has_health_claim: false },
      },
    ],
    submissionNo: 1,
    priceCharged: 3900,
    submittedAt: daysAgo(6),
    slaDueAt: hoursFrom(daysAgo(6), Number(svcSupplementFull().slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(7) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(6) },
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
        reasonCodes: [ReturnReasonCode.LOW_RESOLUTION, ReturnReasonCode.ILLEGIBLE_SCAN],
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
        bodyEn: "Please supply the carton artwork at 300 DPI minimum. Current files are ~120 DPI and text is not legible for SFDA review.",
        bodyAr: "يرجى تزويدنا بتصميم الكرتون بدقة 300 DPI كحد أدنى. الملفات الحالية حوالي 120 DPI والنص غير مقروء لمراجعة الهيئة.",
        createdAt: returnedB,
      },
    ],
  });

  // 13) CANCELLED — Gulf Beauty SABER SCOC, client cancelled after submission
  const submitted13 = daysAgo(15);
  const cancelled13 = daysAgo(13);
  await seedRequest({
    requestNo: "ATL-2026-000413",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfOwner.id,
    assignedToUserId: intake.id,
    state: RequestState.CANCELLED,
    items: [
      {
        serviceItem: svcSaberScoc,
        productNameEn: "Ceramic Diffuser 200 ml",
        productNameAr: "مبخرة سيراميك 200 مل",
        brand: "Gulf Home",
        productAttrs: {
          shipment_details: "1x40ft container, Jeddah Islamic Port",
          importer_information: "Gulf Beauty Trading LLC",
          saber_request_number: "SABER-REQ-2026-55231",
          product_certificates: [
            { certificate_number: "PCOC-2026-771102", models: "Ceramic Diffuser 200ml — White" },
          ],
        },
      },
    ],
    submissionNo: 1,
    priceCharged: 1200,
    submittedAt: submitted13,
    slaDueAt: hoursFrom(submitted13, Number(svcSaberScoc.slaHours)),
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: daysAgo(16) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfOwner.id, actorRole: Role.CLIENT_OWNER, createdAt: submitted13 },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted13, 3),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.CANCELLED,
        actorUserId: gulfOwner.id,
        actorRole: Role.CLIENT_OWNER,
        note: "Shipment cancelled by the client before certification completed.",
        createdAt: cancelled13,
      },
    ],
    comments: [
      {
        authorUserId: gulfOwner.id,
        direction: CommentDirection.CLIENT_TO_ATLAS,
        bodyEn: "The underlying shipment order was cancelled by our buyer — please cancel this SCOC request.",
        bodyAr: "تم إلغاء طلب الشحنة الأساسي من قبل المشتري — يرجى إلغاء طلب شهادة المطابقة هذه.",
        createdAt: cancelled13,
      },
    ],
  });

  // 14) ACCEPTED — Al Noor multi-item SABER request (PCOC + SCOC bundled)
  const submitted14 = daysAgo(2);
  await seedRequest({
    requestNo: "ATL-2026-000414",
    organisationId: alNoor.id,
    createdByUserId: alNoorAdmin.id,
    assignedToUserId: intake.id,
    state: RequestState.ACCEPTED,
    items: [
      {
        serviceItem: svcSaberPcoc,
        productNameEn: "Digital Thermometer TH-220",
        productNameAr: "ميزان حرارة رقمي TH-220",
        brand: "Al Noor MedTech",
        productAttrs: {
          product_category: "Medical devices",
          hs_code: "9025.19",
          manufacturer: "Al Noor MedTech Factory",
          country_of_origin: "Saudi Arabia",
          technical_regulation: "LOW_VOLTAGE_ELECTRICAL",
        },
      },
      {
        serviceItem: svcSaberScoc,
        productNameEn: "Digital Thermometer TH-220",
        productNameAr: "ميزان حرارة رقمي TH-220",
        brand: "Al Noor MedTech",
        productAttrs: {
          shipment_details: "2x20ft container, King Abdulaziz Port",
          importer_information: "Al Noor Pharmaceuticals Co.",
          saber_request_number: "SABER-REQ-2026-55898",
          product_certificates: [
            { certificate_number: "Pending PCOC issuance", models: "TH-220, TH-220S" },
          ],
        },
      },
    ],
    submissionNo: 1,
    priceCharged: 4000,
    submittedAt: submitted14,
    slaDueAt: hoursFrom(submitted14, Number(svcSaberPcoc.slaHours)),
    attachFirstDoc: true,
    events: [
      { toState: RequestState.DRAFT, actorUserId: alNoorAdmin.id, actorRole: Role.CLIENT_ADMIN, note: "Bundled PCOC + SCOC cart", createdAt: daysAgo(3) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: alNoorAdmin.id, actorRole: Role.CLIENT_ADMIN, createdAt: submitted14 },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted14, 2),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        note: "Both items documented sufficiently; queued for SABER submission",
        createdAt: hoursFrom(submitted14, 10),
      },
    ],
  });

  // 15) ASSESSMENT_QUEUED — Gulf Beauty Laboratory Testing Coordination
  const submitted15 = daysAgo(1);
  await seedRequest({
    requestNo: "ATL-2026-000415",
    organisationId: gulfBeauty.id,
    createdByUserId: gulfUser.id,
    assignedToUserId: evaluator.id,
    state: RequestState.ASSESSMENT_QUEUED,
    items: [
      {
        serviceItem: svcLabTesting,
        productNameEn: "Charcoal Face Wash 150 ml",
        productNameAr: "غسول وجه بالفحم 150 مل",
        brand: "Gulf Glow",
        productAttrs: { required_standard: "GSO 1943", required_tests: "Microbial limits, heavy metals screen" },
      },
    ],
    submissionNo: 1,
    priceCharged: 800,
    submittedAt: submitted15,
    slaDueAt: hoursFrom(submitted15, Number(svcLabTesting.slaHours)),
    attachFirstDoc: false,
    events: [
      { toState: RequestState.DRAFT, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: daysAgo(2) },
      { fromState: RequestState.DRAFT, toState: RequestState.SUBMITTED, actorUserId: gulfUser.id, actorRole: Role.CLIENT_USER, createdAt: submitted15 },
      {
        fromState: RequestState.SUBMITTED,
        toState: RequestState.UNDER_INTAKE_REVIEW,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted15, 2),
      },
      {
        fromState: RequestState.UNDER_INTAKE_REVIEW,
        toState: RequestState.ACCEPTED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted15, 6),
      },
      {
        fromState: RequestState.ACCEPTED,
        toState: RequestState.ASSESSMENT_QUEUED,
        actorUserId: intake.id,
        actorRole: Role.INTAKE_OFFICER,
        createdAt: hoursFrom(submitted15, 6),
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
    include: { items: true },
    orderBy: { requestNo: "asc" },
  });

  let invSeq = 1;
  for (const req of allBilled) {
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
          create: req.items.map((it) => ({
            description: `${req.requestNo} · ${it.productNameEn}`,
            qty: 1,
            unitPrice: it.basePrice,
            lineTotal: it.basePrice,
          })),
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
      const payAmount = invoice.status === "PAID" ? total : total.mul(0.5).toDecimalPlaces(2);
      const payment = await prisma.payment.create({
        data: {
          organisationId: req.organisationId,
          amount: payAmount,
          method: "BANK_TRANSFER",
          reference: `TRX-${req.requestNo.slice(-4)}`,
          proofStorageKey: `uploads/${req.organisationId}/payments/${invoiceNo}-proof.pdf`,
          status: "CONFIRMED",
          receivedAt: hoursFrom(req.submittedAt ?? daysAgo(1), 48),
          confirmedByUserId: finance.id,
          confirmedAt: hoursFrom(req.submittedAt ?? daysAgo(1), 50),
        },
      });
      await prisma.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, amount: payAmount },
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
          createdByUserId: finance.id,
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

  // Push Al Noor over credit limit for admin finance tile
  await prisma.organisation.update({
    where: { id: alNoor.id },
    data: { creditLimit: new Prisma.Decimal(8000), autoHoldWhenOverLimit: true },
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
      createdByUserId: finance.id,
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
    where: { submittedAt: { not: null }, state: { not: RequestState.DRAFT }, invoices: { none: {} } },
    include: { items: true },
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
          create: req.items.map((it) => ({
            description: `${req.requestNo} · ${it.productNameEn}`,
            qty: 1,
            unitPrice: it.basePrice,
            lineTotal: it.basePrice,
          })),
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
  const requestItemCount = await prisma.requestItem.count();
  const invoiceCount = await prisma.invoice.count();
  const paymentCount = await prisma.payment.count();
  const ledgerCount = await prisma.ledgerEntry.count();
  const serviceItemCount = await prisma.serviceItem.count();
  const organisationCount = await prisma.organisation.count();
  const userCount = await prisma.user.count();

  // ── Materialise placeholder files for every seeded storage key ────────────
  // The DB rows reference documents, payment proofs, and logos by storage key;
  // without the physical files, the auth-gated /api/storage route 404s and the
  // demo shows broken document viewers and logos. Write a placeholder for each.
  const orgLogos = await prisma.organisation.findMany({
    where: { logoKey: { not: null } },
    select: { logoKey: true, nameEn: true, type: true },
  });
  // The real Atlas brand logo (from atls.com.sa) ships in the repo; demo client
  // organisations keep a generated initial-tile placeholder.
  const atlasLogo = await readFile(path.join(process.cwd(), "prisma", "seed-assets", "atlas-logo.svg")).catch(() => null);
  const logoColors = ["#2563eb", "#b45309", "#7c3aed"];
  let placeholderIndex = 0;
  for (const org of orgLogos) {
    if (!org.logoKey) continue;
    const body =
      org.type === OrganisationType.ATLAS && atlasLogo
        ? atlasLogo
        : placeholderLogoSvg(org.nameEn.trim().charAt(0).toUpperCase() || "A", logoColors[placeholderIndex++ % logoColors.length] ?? "#2563eb");
    await writeSeedFile(org.logoKey, body, "image/svg+xml");
  }

  const docVersions = await prisma.documentVersion.findMany({ select: { storageKey: true } });
  const paymentProofs = await prisma.payment.findMany({ where: { proofStorageKey: { not: null } }, select: { proofStorageKey: true } });
  const pdfKeys = new Set<string>();
  for (const v of docVersions) pdfKeys.add(v.storageKey);
  for (const p of paymentProofs) {
    if (p.proofStorageKey) pdfKeys.add(p.proofStorageKey);
  }
  for (const key of pdfKeys) {
    await writeSeedFile(key, PLACEHOLDER_PDF, "application/pdf");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        password: PASSWORD,
        admin: { email: "admin@atlas.com", password: ADMIN_PASSWORD },
        organisations: organisationCount,
        users: userCount,
        serviceItems: serviceItemCount,
        coupons: 3,
        requests: requestCount,
        requestItems: requestItemCount,
        invoices: invoiceCount,
        payments: paymentCount,
        ledgerEntries: ledgerCount,
        staff: {
          intake: intake.email,
          evaluator: evaluator.email,
          reviewer: reviewer.email,
          decision: decisionMaker.email,
          finance: finance.email,
          catalogue: catalogueManager.email,
          quality: qualityManager.email,
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
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
