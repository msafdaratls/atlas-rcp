-- General standards apply to every product under a TechnicalRegulation, so
-- they are read from TechnicalRegulation.standards (kind: GENERAL) rather than
-- resolved per tariff item. The per-item FK was only ever populated for
-- single-match HS codes, leaving the general standard silently unset for most
-- products (all 1,527 textile items, 73 of 149 kitchen-tools items).

-- DropForeignKey
ALTER TABLE "TariffItem" DROP CONSTRAINT "TariffItem_generalStandardId_fkey";

-- AlterTable
ALTER TABLE "TariffItem" DROP COLUMN "generalStandardId";
