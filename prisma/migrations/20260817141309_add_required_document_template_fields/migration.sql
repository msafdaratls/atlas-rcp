-- AlterTable
ALTER TABLE "RequiredDocument" ADD COLUMN     "templateFileName" TEXT,
ADD COLUMN     "templateMimeType" TEXT,
ADD COLUMN     "templateStorageKey" TEXT;
