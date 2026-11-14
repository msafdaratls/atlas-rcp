ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationOutbox" ADD COLUMN "leaseToken" TEXT, ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);
