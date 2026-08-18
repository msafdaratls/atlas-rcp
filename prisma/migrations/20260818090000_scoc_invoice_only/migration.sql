-- SCOC (SAB-002) upload fix: the client (or an admin on their behalf) only
-- ever submits the commercial invoice for a SABER shipment certificate.
-- Packing list was never actually required, and the PCOC certificate is
-- already captured as structured data (product_certificates, added in
-- migration 20260817160000) rather than as a document upload. Drop the two
-- extra required-document rows so the upload step only asks for the invoice.
--
-- ON DELETE SET NULL on RequestDocument.requiredDocumentId means any
-- already-uploaded packing-list/PCOC files on past requests are preserved,
-- just detached from the (now-removed) requirement.

DELETE FROM "RequiredDocument"
WHERE "serviceItemId" = (SELECT "id" FROM "ServiceItem" WHERE "code" = 'SAB-002')
  AND "code" IN ('PACKING_LIST', 'PRODUCT_CERTIFICATE');
