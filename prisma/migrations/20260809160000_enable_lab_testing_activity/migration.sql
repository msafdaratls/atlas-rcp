-- LAB-001 (Laboratory Testing Coordination) is the one catalogue service
-- whose entire purpose is coordinating lab testing, but requiresLabTesting
-- was left at its default `false` when the SABER/Testing/Cosmetics
-- catalogue was seeded (migration 20260806052126). That flag is what makes
-- the Evaluation-stage "Laboratory Testing" activity panel (schedule, link
-- test reports, mark complete) appear on a request at all — with it off,
-- the fully-built activity UI/actions/schema were unreachable in prod.
UPDATE "ServiceItem"
SET "requiresLabTesting" = true
WHERE "code" = 'LAB-001';
