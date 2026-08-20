/**
 * SCOC (SABER Shipment Certificate of Conformity, and its cosmetics
 * equivalent) and Lab Testing Coordination service-code classification —
 * single source of truth shared between server queries/actions and client
 * components. Previously redefined separately in admin/queries.ts,
 * external-deliverable-panel.tsx, admin-request-detail.tsx,
 * client-request-detail.tsx, and the certificate PDF route — three of those
 * five copies had already silently drifted (two used the SABER+cosmetic
 * pair, two checked SABER only, with no shared name explaining why), which
 * is exactly the failure mode a fix landing for one copy and not its
 * siblings produces. Mirrors evaluation-report-labels.ts's pattern: plain
 * module, no "use server"/"use client", so both sides import the same
 * values directly instead of keeping their own copy in sync by hand.
 */

export const SABER_SCOC_SERVICE_CODE = "SAB-002";
export const COSMETIC_SCOC_SERVICE_CODE = "SFDA-COS-002";
export const SCOC_SERVICE_CODES = [
  SABER_SCOC_SERVICE_CODE,
  COSMETIC_SCOC_SERVICE_CODE,
] as const;

export function isScocServiceCode(code: string): boolean {
  return (SCOC_SERVICE_CODES as readonly string[]).includes(code);
}

export function isScocOnlyRequest(serviceCodes: string[]): boolean {
  return serviceCodes.length > 0 && serviceCodes.every(isScocServiceCode);
}

/**
 * SABER's certificate layout (HS code, technical regulation, etc.) only
 * applies to SAB-002 — the cosmetics equivalent's certificate is an uploaded
 * SFDA file, not Atlas-generated, so it never gets the auto-generated
 * PDF/download button.
 */
export function isSaberScocServiceCode(code: string): boolean {
  return code === SABER_SCOC_SERVICE_CODE;
}

export const LAB_TESTING_SERVICE_CODE = "LAB-001";

export function isLabTestingOnlyRequest(serviceCodes: string[]): boolean {
  return (
    serviceCodes.length > 0 &&
    serviceCodes.every((code) => code === LAB_TESTING_SERVICE_CODE)
  );
}
