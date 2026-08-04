-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- DropIndex
DROP INDEX "Organisation_crNumber_idx";

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "clientCategory" "ClientCategory",
ADD COLUMN     "isInternational" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_crNumber_key" ON "Organisation"("crNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

