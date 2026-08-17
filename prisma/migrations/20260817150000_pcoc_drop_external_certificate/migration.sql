-- PCOC (SAB-001) no longer uses the External submission / certificate-attachment
-- flow: the External Deliverable panel is now hidden for it (both mid-evaluation
-- and at REPORT_ISSUED), and it's excluded from the REPORT_ISSUED -> CLOSED
-- certificate-required gate.

UPDATE "ServiceItem"
SET "deliverableType" = 'INTERNAL_REPORT'
WHERE "code" = 'SAB-001';
