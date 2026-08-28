/**
 * One-off import: loads the two standalone HS-code checklist tools
 * (Food-Contact Kitchen Tools & Appliances, Textile Products) into the
 * TechnicalRegulation/Standard/TariffItem catalog under SAB-001 (PCOC).
 *
 * The source files are hand-authored JS object literals embedded in a
 * <script> tag (unquoted keys, not strict JSON), so each top-level
 * `const NAME = <literal>;` is extracted by regex and evaluated with
 * Node's vm module rather than JSON.parse.
 *
 * Idempotent: every row is upserted on its natural unique key, so running
 * this script again after the source files change just updates content —
 * it never duplicates rows.
 *
 * Run: npx tsx prisma/import-hs-checklists.ts
 */
import { PrismaClient, StandardKind } from "@prisma/client";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const prisma = new PrismaClient();

type HtmlSource = {
  file: string;
  regulationCode: string;
  titleEn: string;
  titleAr: string;
};

const SOURCES: HtmlSource[] = [
  {
    file: "/Users/muhammadusamasafdar/Downloads/COC System/Conformity Assessment Checklist for Food Contact Kitchen Tools and Appliances.html",
    regulationCode: "KITCHEN_TOOLS_FOOD_SAFETY_HS",
    titleEn:
      "Technical Regulation for Food Safety in Kitchen Tools and Appliances (04-06-19-171)",
    titleAr: "اللائحة الفنية للسلامة الغذائية في الأدوات والأجهزة المستخدمة في المطبخ",
  },
  {
    file: "/Users/muhammadusamasafdar/Downloads/COC System/textile-products-checklist-tool (1).html",
    regulationCode: "TEXTILE_PRODUCTS_HS",
    titleEn: "Technical Regulation for Textile Products",
    titleAr: "اللائحة الفنية للمنتجات النسيجية",
  },
];

type Row = { code: string; ref?: string; refEn?: string; desc: string; descEn: string; cond?: boolean };
type Product = { id: number; cat: string; catEn: string; ar: string; en: string; std: string[]; assessType?: string };
type HsCodeEntry = { code: string; ar: string; en: string; certs?: string; certsEn?: string };
type StdTitle = { ar: string; en: string };
type StdDetailRow = { code: string; desc: string; descEn: string };
/** DOCS_ITEMS uses `id`/`name`/`nameEn` where the checklist tables use code/desc. */
type DocRow = { id: string; name: string; nameEn: string; ref?: string; refEn?: string };

function extract<T>(txt: string, name: string): T {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*([\\s\\S]*?);\\r?\\n`);
  const m = txt.match(re);
  if (!m) throw new Error(`${name} not found in source file`);
  return vm.runInNewContext(`(${m[1]})`) as T;
}
function tryExtract<T>(txt: string, name: string): T | null {
  try {
    return extract<T>(txt, name);
  } catch {
    return null;
  }
}

function toCheckItem(row: Row) {
  return {
    code: row.code,
    titleEn: row.descEn,
    titleAr: row.desc,
    applicability: row.refEn && row.ref ? `${row.ref} / ${row.refEn}` : undefined,
    priority: row.cond ? "conditional" : undefined,
  };
}

async function importSource(source: HtmlSource, serviceItemId: string) {
  const txt = readFileSync(source.file, "utf8");

  const PRODUCTS = extract<Product[]>(txt, "PRODUCTS");
  const HS_TO_PRODUCTS = extract<Record<string, number[]>>(txt, "HS_TO_PRODUCTS");
  const HS_CODES = tryExtract<HsCodeEntry[]>(txt, "HS_CODES") ?? [];
  const STANDARD_TITLES = extract<Record<string, StdTitle>>(txt, "STANDARD_TITLES");
  const STANDARD_TEST_DETAILS = extract<Record<string, StdDetailRow[]>>(txt, "STANDARD_TEST_DETAILS");
  const GENERAL_ITEMS = extract<Row[]>(txt, "GENERAL_ITEMS");
  const LABEL_ITEMS = extract<Row[]>(txt, "LABEL_ITEMS");
  const TEST_GENERAL_ITEMS = extract<Row[]>(txt, "TEST_GENERAL_ITEMS");
  const DOCS_ITEMS = tryExtract<DocRow[]>(txt, "DOCS_ITEMS") ?? [];

  const singleGeneralCode = tryExtract<string>(txt, "GENERAL_STANDARD_CODE");
  const multiGeneralCodes = tryExtract<string[]>(txt, "GENERAL_STANDARD_CODES");
  const generalStandardCodes = new Set<string>(
    singleGeneralCode ? [singleGeneralCode] : multiGeneralCodes ?? [],
  );

  const hsCodeById = new Map(HS_CODES.map((h) => [h.code, h]));
  const productById = new Map(PRODUCTS.map((p) => [p.id, p]));

  // One flat check set, not one per source table. The admin editor edits a
  // regulation's general checklist as a single flat item list and saves it
  // back as one set, so splitting it here would make the first Save silently
  // drop everything after the first set. Item codes (A-* vs T-*) still carry
  // the source distinction.
  const generalChecklist = [
    {
      code: "GENERAL",
      titleEn: "General Checklist",
      titleAr: "القائمة العامة",
      items: [...GENERAL_ITEMS, ...TEST_GENERAL_ITEMS].map(toCheckItem),
    },
  ];
  const labelingChecklist = [
    {
      code: "LABEL",
      titleEn: "Labeling Information",
      titleAr: "بيانات البطاقة الإيضاحية",
      items: LABEL_ITEMS.map(toCheckItem),
    },
  ];
  const documentsChecklist = [
    {
      code: "DOCUMENTS",
      titleEn: "Required Documents",
      titleAr: "المستندات المطلوبة",
      items: DOCS_ITEMS.map((row) => ({
        code: row.id,
        titleEn: row.nameEn,
        titleAr: row.name,
        applicability: row.ref && row.refEn ? `${row.ref} / ${row.refEn}` : undefined,
      })),
    },
  ];

  const regulation = await prisma.technicalRegulation.upsert({
    where: { serviceItemId_code: { serviceItemId, code: source.regulationCode } },
    create: {
      serviceItemId,
      code: source.regulationCode,
      titleEn: source.titleEn,
      titleAr: source.titleAr,
      generalChecklist,
      labelingChecklist,
      documentsChecklist,
    },
    update: {
      titleEn: source.titleEn,
      titleAr: source.titleAr,
      generalChecklist,
      labelingChecklist,
      documentsChecklist,
    },
  });

  const standardIdByCode = new Map<string, string>();
  for (const [code, title] of Object.entries(STANDARD_TITLES)) {
    const kind: StandardKind = generalStandardCodes.has(code) ? "GENERAL" : "SPECIFIC";
    const details = STANDARD_TEST_DETAILS[code];
    const checklist = details
      ? [
          {
            code,
            titleEn: title.en,
            titleAr: title.ar,
            standard: code,
            items: details.map((d) => ({ code: d.code, titleEn: d.descEn, titleAr: d.desc })),
          },
        ]
      : [];
    const standard = await prisma.standard.upsert({
      where: { technicalRegulationId_code: { technicalRegulationId: regulation.id, code } },
      create: {
        technicalRegulationId: regulation.id,
        code,
        titleEn: title.en,
        titleAr: title.ar,
        kind,
        checklist,
      },
      update: { titleEn: title.en, titleAr: title.ar, kind, checklist },
    });
    standardIdByCode.set(code, standard.id);
  }

  let processed = 0;
  for (const [hsCode, productIds] of Object.entries(HS_TO_PRODUCTS)) {
    const hsInfo = hsCodeById.get(hsCode);
    let productTitleEn = hsInfo?.en ?? hsCode;
    let productTitleAr = hsInfo?.ar ?? hsCode;
    let specificStandardIds: string[] = [];
    let conformityModule: string | null = null;

    if (productIds.length === 1) {
      const product = productById.get(productIds[0]);
      if (product) {
        productTitleEn = product.en;
        productTitleAr = product.ar;
        // ALL of the product's specific standards, not just the first — the
        // source tools render one checklist block per standard, and several
        // products carry 2-4 (e.g. Aluminium Household Articles → SASO-369 +
        // EN-601 + EN-602). General standards are excluded: they apply to
        // every product and are read from the regulation at evaluation time.
        specificStandardIds = product.std
          .filter((stdCode) => !generalStandardCodes.has(stdCode))
          .map((stdCode) => standardIdByCode.get(stdCode))
          .filter((id): id is string => Boolean(id));
        conformityModule =
          product.assessType === "type1a"
            ? "Type 1a"
            : product.assessType === "type3"
              ? "Type 3"
              : "Type 3 (COC) or Saudi Quality Mark (QM)";
      }
    } else if (productIds.length === 0) {
      conformityModule = "Type 1a";
    }
    // productIds.length > 1: multi-match HS code — the source tool resolves
    // these with a sub-category picker this import does not replicate, so the
    // SPECIFIC standards are left unset for Quality/CoC to assign (the
    // workbook's flat one-row-per-HS-code sheet is where that ambiguity gets
    // settled). The general standards and both regulation-level checklists
    // still apply, so the evaluation is usable meanwhile.

    const requiredCertificates = (hsInfo?.certsEn ?? "Quality Mark (QM) or Product Certificate of Conformity (COC)")
      .split(" or ")
      .map((s) => s.trim())
      .filter(Boolean);

    const tariffItem = await prisma.tariffItem.upsert({
      where: { technicalRegulationId_hsCode: { technicalRegulationId: regulation.id, hsCode } },
      create: {
        technicalRegulationId: regulation.id,
        hsCode,
        productTitleEn,
        productTitleAr,
        requiredCertificates,
        conformityModule,
      },
      update: {
        productTitleEn,
        productTitleAr,
        requiredCertificates,
        conformityModule,
      },
      select: { id: true },
    });

    // The sheet/source defines the full link set for this item, so replace
    // rather than accumulate — otherwise a standard removed upstream would
    // linger forever.
    await prisma.tariffItemStandard.deleteMany({
      where: { tariffItemId: tariffItem.id, standardId: { notIn: specificStandardIds } },
    });
    if (specificStandardIds.length > 0) {
      await prisma.tariffItemStandard.createMany({
        data: specificStandardIds.map((standardId, index) => ({
          tariffItemId: tariffItem.id,
          standardId,
          sortOrder: index,
        })),
        skipDuplicates: true,
      });
    }
    processed++;
  }

  console.log(
    `[${source.regulationCode}] regulation ${regulation.id}, ${standardIdByCode.size} standards, ` +
      `${processed} tariff items upserted`,
  );
}

async function main() {
  const sab001 = await prisma.serviceItem.findFirst({ where: { code: "SAB-001" } });
  if (!sab001) throw new Error("ServiceItem SAB-001 not found — run prisma/seed.ts first");

  for (const source of SOURCES) {
    await importSource(source, sab001.id);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
