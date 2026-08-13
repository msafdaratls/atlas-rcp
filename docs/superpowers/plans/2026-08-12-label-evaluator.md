# Atlas COC — Label Evaluator (SFDA + Cosmetics) build plan

**Date:** 2026-08-12 (rev. 3 — re-sequenced after auditing real data completeness; see design doc §0.4)
**Design doc:** `docs/superpowers/specs/2026-08-12-label-evaluator-design.md`
**Status:** Milestones 1–5 built and browser-verified (2026-08-12/13) — **see `2026-08-13-label-evaluator-handover.md` for current state, credentials, and next steps before resuming work here.** This file's checklists below are kept as the historical build log.

## Sequencing rationale

The SFDA workbook has now been parsed directly. Findings that set the sequence:

- **113 items confirmed**, scoring formula matches our implementation exactly, and all three predicted structural quirks are real (FD 55's missing English-KB column, FD 2233's priority-summary cell offset, the self-declared gelatin gap).
- **The workbook uses two different DB schemas.** GSO_9 / FD_55 / FD_2233 (80 items) carry `Compliant When` + `Priority`; FD_2333 / FD_2500 (33 items) have **no such columns at all**. The repo's `sfda-checksets.ts` import is faithful — nothing was lost. Those 33 values cannot be backfilled from any revision of this workbook.
- **Section 5 (Food Additives) lookups are complete** — 49/49 Category 13.6 records and 183/183 GMP records are present. Fully buildable now.
- **Section 4 (Health Claims) lookups are not.** Tables 1 & 2 are declared at 376 + 50 records but contain only 10 + 28 samples, pointing at sheets absent from the file. Items 10–13 stay unautomatable until that file arrives.

So: the shared scaffolding, all 113 SFDA rules, and Section 5's lookups can start immediately. Only 4 items are genuinely blocked.

## Pre-work (parallel with Milestone 1 — not blocking)

- [x] ~~Receive the SFDA workbook~~ → **received and parsed**.
- [ ] **Receive the cosmetics workbook** from Atlas.
- [ ] **Request the file containing SFDA Tables 1 & 2** (376 permitted health claims + 50 nutrition claims). Blocks only Section 4 items 10–13.
- [x] ~~Excel parser library~~ → **`exceljs`** (design doc §7.4).
- [x] ~~Keep or drop the promotion bridge~~ → **ships**, under design doc §13.3's constraints.
- [ ] Remaining product-owner decisions, all gating later milestones only: cosmetics verdict formula (#1, Milestone 5), Critical-item policy incl. the 33 unprioritised items (#2, flag ships OFF regardless).

## Milestone 1 — Schema, queue, and guardrails — ✅ DONE (2026-08-12)

- [x] Prisma migration for all `Label*` models and enums (design doc §3): `20260812114808_add_label_evaluator_schema`. **Verified by reading the generated SQL before applying:** zero `ALTER TABLE` statements against any pre-existing table — the only touch to an existing model is the `labelAssessments` back-relation on `RequestItem` (a Prisma relation field, no DB column).
- [x] FK choices verified as designed: `LabelAssessment.requestItemId` is optional with `onDelete: SetNull`; `requestNo`/`organisationId`/`organisationName`/`serviceItemCode` snapshotted immutably. Confirmed live: created a real draft Request/Item/Document/Version + a real `LabelAssessment` referencing it, replayed `removeRequestDocument`'s and `createOrSelectDraft`'s exact delete sequences, and the assessment survived with `requestItemId: null` and its snapshot intact.
- [x] `documentsFingerprint` implemented as a scalar (`src/server/label-eval/fingerprint.ts` — sha256 of sorted, joined per-document sha256s), indexed, not an array comparison.
- [x] `LabelEvalServiceMapping` seeded via data migration `20260812120000_seed_label_eval_service_mapping`: `SUPPLEMENT_LABEL_FULL` + `SUPPLEMENT_LABEL_REREVIEW` → `SFDA_SUPPLEMENTS`; `SFDA-COS-001` ("Technical Label Assessment," the only one with a `GSO_1943` checkSet) → `COSMETICS`. Verified live: exactly 3 rows, and `SFDA-COS-002`/`-003`/`-004` (SCOC/GHAD/FASAH) confirmed absent.
- [x] **Deviation from spec, logged in design doc §14:** no new `rbac.ts` permission added. `REQUESTS_ADMIN_ROLES` already equals the exact role set needed (incl. `QUALITY_MANAGER`), so all label-eval code gates on the existing `requests:admin` (and `catalogue:manage` for the future KB admin surface) instead. Zero lines changed in `rbac.ts`.
- [x] "Needs Evaluation" queue (`src/server/label-eval/queries.ts`): `listNeedsEvaluation()` + `assertRequestItemEvaluable()` (the §13.5 open-time re-check, throwing a typed `EvaluationUnavailableError` carrying the current state). Read-only; `src/server/admin/queries.ts` untouched.
- [x] Concurrency primitives (`src/server/label-eval/concurrency.ts`, design doc §13.4): `claimAssessment` (soft claim + logged take-over), `assertNoInFlightRun` (blocks a second concurrent extraction per item), `applyVerdictOverride` (guarded `updateMany`-with-expected-previous-verdict, borrowing the idiom from `src/server/admin/actions.ts`'s state-transition guards).
- [x] **Non-regression:** all 72 pre-existing tests pass unmodified. **Deviation from spec, logged in design doc §14:** the SetNull/copy-on-ingest check was run as a one-off verification script against the real dev DB rather than committed as a permanent `*.test.ts` file — `ci.yml`'s `test` job has no Postgres service, so a DB-touching test would break CI on every run, which is itself the exact non-regression this feature must not cause. Follow-up (not resolved): add a Postgres service to CI first, if permanent integration coverage is wanted.

**New files this milestone:** `src/server/label-eval/fingerprint.ts`, `src/server/label-eval/queries.ts`, `src/server/label-eval/concurrency.ts`. **Schema/migrations:** `prisma/schema.prisma` (additive), two new migration folders. Full project typecheck (`tsc --noEmit`) clean throughout.

## Milestone 2 — Storage ingest & extraction pipeline (shared)

- [ ] **Copy-on-ingest**: copy each source `DocumentVersion` file to an evaluator-owned storage key via the existing `StorageAdapter`. Never reference the request's key — clients can hard-delete documents and their files while in `DRAFT`/`RETURNED_TO_CLIENT` (`requests/actions.ts:975-1005`), which would otherwise destroy a completed assessment's audit evidence.
- [ ] `LabelExtractionJob` outbox table + worker under `src/server/label-eval/`, modelled on `src/server/notifications/worker.ts`. Run via the existing `npm run jobs` process.
- [ ] `ExtractionProvider` interface; PaddleOCR-VL (EN/numeric/tables) + Google Cloud Vision (Arabic) implementations. Server-side credentials only.
- [ ] Flag every Arabic and every low-confidence field `needsReview = true`. Persist `full_label_text` for audit.
- [ ] Cache by document `sha256`; cost-guard counter for Vision calls.
- [ ] **Test:** report still renders after the client deletes the original source document.

## Milestone 3 — KB ingestion & versioning (shared, both domains)

- [ ] Add the **`exceljs`** dependency; build the parser with an **explicit, unit-tested per-sheet column-mapping table**. Known quirks are data facts to surface as named warnings, never silent drops: FD_55 has no English KB column; `DB_Food Additives` / `DB_Health and Nutrition Claims` are multi-part sheets with lettered sub-tables; FD 2233's priority-summary cell offset; the self-declared missing gelatin GMP record. Resolve cell values (not formulae); quote special-character sheet names exactly.
- [ ] Import SFDA `kb_v1`: **all 113 items** from `sfda-checksets.ts`, preserving both DB schemas (Family A carries `compliantWhen`/`priority`; Family B carries `decisionRule`/`referenceRange`/`applicability`). Do **not** attempt to synthesise the missing 33 `compliantWhen`/`priority` values — they do not exist in the source.
- [ ] Load Section 5 lookups from the workbook: 49 Category 13.6 records + 183 GMP records (both verified complete).
- [ ] Section 4 lookups (Tables 1 & 2) are **deferred** pending the source file; items 10–13 emit `REQUIRES_ADDITIONAL_DATA` with their reference ranges attached in the meantime.
- [ ] Import cosmetics `kb_v1` from its workbook — categories, GSO 1943 requirements, GSO 2528 claims framework, per-category claim banks, COSING Annex II/III, SFDA Tests v4.0 trigger rules. Reconcile the real sheet names against design doc §7.2 and hard-fail on contract mismatch rather than guessing.
- [ ] Dataset admin UI at `/admin/label-evaluator/{domain}/datasets`: upload → validate → diff vs. active → atomic activate → rollback. `CATALOGUE_MANAGER`/`SYSTEM_ADMIN` only.
- [ ] **Test:** a contract-violating workbook fails with a specific error and creates no partial version; activation never alters historical `LabelAssessment` rows.

## Milestone 4 — SFDA evaluator + UI

- [ ] Queue page `/admin/label-evaluator/sfda`: SLA-sorted, First-submission/Resubmission badge, optional assigned-to-me filter (label it as new — nothing equivalent exists today).
- [ ] Open flow: re-verify `Request.state` at open time; ingest the item's attached artwork; no manual upload UI.
- [ ] Evaluator registry + six SFDA evaluators. **Two mapping passes, not one:** `compliantWhen` drives GSO_9/FD_55/FD_2233 (80 items); `decisionRule` + `referenceRange` + `applicability` drive FD_2333/FD_2500 (33 items, mostly `lookup` / `requires_additional_data`).
- [ ] **`lookup` evaluators fail safe:** a lookup miss yields `REQUIRES_ADDITIONAL_DATA` with the reference range + evidence-required text — never `COMPLIANT`, never `NON_COMPLIANT`. Unit-test with gelatin (Section 5 item 5), the gap the workbook itself documents.
- [ ] `LabelKbRule.code` must match `ServiceItem.checkSets` codes exactly (e.g. `GSO_9_01`) — otherwise promotion silently drops everything.
- [ ] Verification-gate UI: editable EN/AR fields, Missing-fields banner, needs-review flags, "Data confirmed — continue". Blocks on missing mandatory fields *and* on a fingerprint mismatch (source documents changed since extraction).
- [ ] Assessment cards: per-section counts, rule code + standard + evidence quote, "Change assessment" override. Show "English KB not provided for this item" rather than a blank panel for the 57 items lacking `knowledgeBaseEn`.
- [ ] Scoring by calling `src/lib/assessment.ts` — do not reimplement.
- [ ] Final verdict bar, frozen report snapshot, PDF via the existing `src/server/finance/pdf.ts` (playwright, already a production dep) — do not add a second PDF stack.
- [ ] **Promotion action** — calls the unmodified `saveAssessment`. Omits `NEEDS_REVIEW`/`REQUIRES_ADDITIONAL_DATA` rather than coercing them (coercion would falsify a compliance record). Shows a pre-flight summary — items to write, items withheld, and whether stale prior-cycle `RequestItem.assessment` data will be overwritten — and requires explicit confirmation. Refuses to promote if any verdict would be dropped for a code mismatch. Records `promotedAt`/`promotedByUserId` + `AuditLog`.
- [ ] **Promotion test:** an assessment containing `REQUIRES_ADDITIONAL_DATA` items promotes the resolvable verdicts only, leaves those items unscored, and the existing `computeAssessment` correctly reports `INCOMPLETE`.
- [ ] **Regression test (corrected):** on a fixture with populated values, a confirmed non-empty field must never yield a "missing" `NON_COMPLIANT`. Do **not** bind this to BEYAN HERBS PROPOLIS — its batch/expiry are genuinely blank templates.
- [ ] **Companion test:** on the BEYAN HERBS fixture, blank batch number and blank expiry/PAO **must** yield `NON_COMPLIANT`, pinning the correct behaviour against a future mistaken "fix".

## Milestone 5 — Cosmetics evaluator + UI

- [ ] Classification step with a first-class refusal: low-confidence or out-of-domain ⇒ `BLOCKED_NO_CATEGORY_MATCH`, no verdicts, no tests, no final verdict. `notApplicable` recorded with the model's reasoning shown. Manual Reclassify override, logged.
- [ ] **Regression test:** the BEYAN HERBS supplement fixture must hit `BLOCKED_NO_CATEGORY_MATCH` — never a nearest-category guess — while the SFDA pipeline processes the same file normally. This is the live tool's exact failure mode (design doc §0.1).
- [ ] `label_presence` / `label_format` evaluators (GSO 1943), reusing the registry.
- [ ] `claim_phase_judgment` — LLM-proposed against the category-scoped claim bank, gated on a **confirmed** category, always overridable, logging model + prompt version.
- [ ] `ingredient_lookup` — COSING Annex II/III cross-check.
- [ ] `required_test_rule` — deterministic category+properties → test list with rule-ID justification table.
- [ ] Cosmetics UI: shared shell + classification block + claims panel + required-tests table + final verdict (formula per open decision #1).

## Milestone 6 — Hardening

- [ ] Determinism test: identical confirmed fields + KB version ⇒ identical non-LLM verdicts, both domains.
- [ ] Historical immutability: activating a new KB version alters no existing assessment's `kbVersionId` or verdicts.
- [ ] `AuditLog` wired for every write: ingest, confirm, override, reclassify, KB upload/activate/rollback, promotion.
- [ ] Cost guards + alert thresholds for Vision and LLM calls.
- [ ] Confirm no secret or API key in any client bundle.
- [ ] Arabic/RTL QA pass across both pages at both locales (default locale is Arabic).
- [ ] Full manual lifecycle walkthrough (submit → … → close) plus resubmission, proving zero behavioural change.
