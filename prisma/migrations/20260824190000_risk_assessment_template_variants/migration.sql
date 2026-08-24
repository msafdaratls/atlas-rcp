-- Per-product risk assessment forms for SAB-001 (PCOC).
--
-- The client supplied one blank Risk Assessment form per SABER technical
-- regulation, so a single templateStorageKey can no longer express the slot:
-- which form to fill depends on the product. RequiredDocumentTemplate holds
-- one blank form per value of the attribute named by the new
-- RequiredDocument.templateVariantAttrKey column.
--
-- The files themselves are NOT installed here — `prisma migrate deploy`
-- cannot copy bytes into the storage volume. Run `npm run db:templates`
-- after migrating; it is idempotent and safe to re-run.

-- AlterTable
ALTER TABLE "RequiredDocument" ADD COLUMN     "templateVariantAttrKey" TEXT;

-- CreateTable
CREATE TABLE "RequiredDocumentTemplate" (
    "id" TEXT NOT NULL,
    "requiredDocumentId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RequiredDocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequiredDocumentTemplate_requiredDocumentId_sortOrder_idx" ON "RequiredDocumentTemplate"("requiredDocumentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RequiredDocumentTemplate_requiredDocumentId_variantKey_key" ON "RequiredDocumentTemplate"("requiredDocumentId", "variantKey");

-- AddForeignKey
ALTER TABLE "RequiredDocumentTemplate" ADD CONSTRAINT "RequiredDocumentTemplate_requiredDocumentId_fkey" FOREIGN KEY ("requiredDocumentId") REFERENCES "RequiredDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Data ────────────────────────────────────────────────────────────────────
-- One of the supplied forms covers Automotive Spare Parts, which was not a
-- value of technical_regulation — without adding it the form could never be
-- matched to a product and would be dead weight. Appended with jsonb ops
-- rather than rewriting the whole document, so this stays correct even if the
-- schema has drifted since 20260817120000, and re-running changes nothing.
UPDATE "ServiceItem"
SET "productAttrSchema" = jsonb_set(
      jsonb_set(
        jsonb_set(
          "productAttrSchema",
          '{properties,technical_regulation,enum}',
          ("productAttrSchema" #> '{properties,technical_regulation,enum}') || '["AUTO_SPARE_PARTS"]'::jsonb
        ),
        '{properties,technical_regulation,helpEn}',
        to_jsonb('Textile Products; Ornaments and Accessories; Paper and Cardboard; Packaging; General Requirements for Machinery Safety; Food Safety in Kitchen Tools and Appliances; Communications and ICT Devices; Building Materials Part 5/4/1; GCC Low Voltage Electrical Equipment and Appliances; Automotive Spare Parts. Your choice also selects which risk assessment form you download.'::text)
      ),
      '{properties,technical_regulation,helpAr}',
      to_jsonb('المنسوجات؛ الحلي والإكسسوارات؛ الورق والكرتون؛ التغليف؛ السلامة العامة للآلات؛ سلامة أدوات وأجهزة المطبخ؛ أجهزة الاتصالات وتقنية المعلومات؛ مواد البناء الجزء 5/4/1؛ الأجهزة الكهربائية منخفضة الجهد؛ قطع غيار المركبات. يحدد اختيارك أيضاً نموذج تقييم المخاطر الذي ستنزّله.'::text)
    )
WHERE "code" = 'SAB-001'
  AND jsonb_typeof("productAttrSchema" #> '{properties,technical_regulation,enum}') = 'array'
  AND NOT ("productAttrSchema" #> '{properties,technical_regulation,enum}' @> '["AUTO_SPARE_PARTS"]'::jsonb);

-- The risk assessment help text now points at a per-regulation form.
UPDATE "RequiredDocument" d
SET "templateVariantAttrKey" = 'technical_regulation',
    "helpEn" = 'Download the form for your technical regulation, fill it out on your Importer Header Letter, then upload the signed file. The risk assessment is product-specific — a separate form is required for each product.',
    "helpAr" = 'نزّل النموذج الخاص باللائحة الفنية لمنتجك، واملأه على الترويسة الرسمية للمستورد (Header Letter)، ثم ارفع الملف موقّعاً. تقييم المخاطر خاص بكل منتج — يلزم نموذج منفصل لكل منتج.'
FROM "ServiceItem" s
WHERE d."serviceItemId" = s."id"
  AND s."code" = 'SAB-001'
  AND d."code" = 'RISK_ASSESSMENT';
