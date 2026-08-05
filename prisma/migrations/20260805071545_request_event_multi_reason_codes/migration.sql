-- Allow a return-to-client event to carry multiple return reason codes
-- instead of exactly one. Adds a new array column, backfills it from the
-- existing scalar column, then drops the old column.

ALTER TABLE "RequestEvent" ADD COLUMN "reasonCodes" "ReturnReasonCode"[] NOT NULL DEFAULT '{}';

UPDATE "RequestEvent"
SET "reasonCodes" = ARRAY["reasonCode"]
WHERE "reasonCode" IS NOT NULL;

ALTER TABLE "RequestEvent" DROP COLUMN "reasonCode";
