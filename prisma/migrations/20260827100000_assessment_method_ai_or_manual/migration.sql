-- AI-vs-Manual assessment route.
--
-- Accepting a request used to open BOTH evaluation paths at once: the item
-- appeared in the Label Evaluator queue (AI) while the request page
-- simultaneously offered the manual checklist. Nothing recorded which one was
-- actually intended. RequestItem.assessmentMethod now records that choice
-- (set at intake acceptance, changeable later by the Evaluator), and each
-- LabelAssessment stamps the route that produced it.
--
-- MANUAL_IN_PROGRESS is the in-flight status of a hand-worked run: it blocks a
-- duplicate run on the same item (IN_FLIGHT_STATUSES) but needs no stall
-- sweep, because only the evaluator's own "complete" action leaves it.
--
-- Both columns are additive and nullable/defaulted, so existing rows keep
-- today's behaviour: assessmentMethod NULL means "not chosen yet" and leaves
-- both routes offered, and every existing assessment is an AI run.

-- CreateEnum
CREATE TYPE "AssessmentMethod" AS ENUM ('AI', 'MANUAL');

-- AlterEnum
ALTER TYPE "LabelAssessmentStatus" ADD VALUE 'MANUAL_IN_PROGRESS';

-- AlterTable
ALTER TABLE "RequestItem" ADD COLUMN     "assessmentMethod" "AssessmentMethod";

-- AlterTable
ALTER TABLE "LabelAssessment" ADD COLUMN     "method" "AssessmentMethod" NOT NULL DEFAULT 'AI';
