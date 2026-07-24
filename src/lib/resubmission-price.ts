import { Prisma } from "@prisma/client";
import type { FaultAttribution } from "@prisma/client";

/**
 * Resolves the price multiplier for a resubmission.
 *
 * `submissionNo` is the value AFTER this resubmit (first submit = 1,
 * first return+resubmit = 2). `freeResubmissions=0` always charges on
 * CLIENT_FAULT; `freeResubmissions=1` makes the first resubmit free.
 *
 * ATLAS_FAULT and REGULATORY_CHANGE never charge.
 */
export function resolveResubmissionPricePct(input: {
  fault: FaultAttribution | string;
  submissionNo: number;
  freeResubmissions: number;
  resubmissionPricePct: Prisma.Decimal | number | string;
}): Prisma.Decimal {
  if (input.fault !== "CLIENT_FAULT") {
    return new Prisma.Decimal(0);
  }
  // Resubmit index: submissionNo 2 → first resubmit (index 1).
  if (input.submissionNo - 1 <= input.freeResubmissions) {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(input.resubmissionPricePct);
}
