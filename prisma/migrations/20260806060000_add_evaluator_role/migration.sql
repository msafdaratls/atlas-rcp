-- Splits Evaluation-stage duties off TECHNICAL_REVIEWER into a dedicated
-- EVALUATOR role, so the same person can no longer perform both Evaluation
-- and Technical Review on the same request (segregation of duties).
--
-- One-time manual step after deploy: an admin must grant EVALUATOR to
-- whichever existing TECHNICAL_REVIEWER users should keep doing evaluation
-- work, since TECHNICAL_REVIEWER's transition rights are narrowed to the
-- Technical Review stage only as of this change (see src/lib/rbac.ts).
ALTER TYPE "Role" ADD VALUE 'EVALUATOR';
