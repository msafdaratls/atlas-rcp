# Label Evaluator — session handover

**For:** whoever (human or Claude) picks this up next.
**Read first:** `docs/superpowers/specs/2026-08-12-label-evaluator-design.md` (the design, rev. 3+ — has the full evidence trail, corrections, and open decisions in §12). This file is status + practical resume-instructions only; don't duplicate design content here.
**Build log:** `docs/superpowers/plans/2026-08-12-label-evaluator.md` (milestone checklist, kept up to date through this session).

---

## 1. Where things actually stand

Everything below has been **built and live-tested in a real browser**, not just typechecked — see the design doc's §14 implementation log and this session's transcript for exact verification steps.

| Piece | Status |
|---|---|
| Schema (all `Label*` models) | ✅ Done, 3 migrations applied |
| SFDA Excel parser | ✅ Done, tested against the real workbook |
| SFDA `kb_v1` | ✅ Imported and **ACTIVE** in the dev DB right now (113 rules, 270 lookups) |
| Storage ingest / extraction job / manual provider | ✅ Done, works end-to-end |
| SFDA evaluator registry (6 types) + scoring | ✅ Done, tested against real data |
| SFDA queue + assessment UI | ✅ Done, full browser walkthrough completed incl. override + promotion into the **existing** manual checklist |
| KB dataset admin UI (upload/diff/activate/rollback) | ✅ Done, both domains, browser-tested incl. a real crash bug found and fixed |
| Cosmetics classifier | ✅ Done, has a real unit test reproducing the original live bug |
| Cosmetics evaluator registry (4 types) + required-tests engine | ✅ Done, browser-tested with synthetic data (now deleted) |
| Cosmetics queue + assessment UI (incl. classification block, blocked state, reclassify, required-tests table) | ✅ Done, browser-tested |
| Real OCR (Google Vision / PaddleOCR-VL) | ❌ Not wired — interface exists, throws if selected without credentials. Manual-entry provider is the active default and is fully functional |
| Cosmetics Excel parser | ❌ **Cannot be built** — no real cosmetics workbook exists yet. Upload UI cleanly refuses cosmetics files with `COSMETICS_SCHEMA_NOT_YET_CONFIRMED` rather than guessing |
| SFDA Tables 1 & 2 (health/nutrition claims) | ❌ Missing from the source workbook — 4 of 113 SFDA items (`FD_2333_10-13`) correctly sit at `REQUIRES_ADDITIONAL_DATA` until supplied |

**Nothing has been committed.** `git status` on branch `production-deploy` shows 7 modified files (all minimal/additive — schema, sidebar nav, instrumentation, two message files, package.json for `exceljs`) and 9 new paths. Full diff stat is in the design doc §14 if you want it without re-running `git status`.

---

## 2. How to resume right now

```bash
cd /Users/muhammadusamasafdar/Desktop/COC
npm run dev            # if not already running — check with: lsof -iTCP:3000 -sTCP:LISTEN
```

Login (seeded demo accounts, password shown):
- `admin@atlas.com` / `AtlasAdmin1` — SYSTEM_ADMIN, can see everything incl. KB dataset admin
- `evaluator@atls.com.sa` / `Atlas@2026` — EVALUATOR, can run assessments but **cannot** reach `/datasets` (correctly denied — `catalogue:manage` requires `CATALOGUE_MANAGER`/`SYSTEM_ADMIN`)

Key URLs (prefix with `http://localhost:3000/en` or `/ar`):
- `/admin/label-evaluator/sfda` — SFDA queue (has one real leftover fixture, see §3)
- `/admin/label-evaluator/sfda/datasets` — SFDA KB admin, one ACTIVE version present
- `/admin/label-evaluator/cosmetics` — Cosmetics queue (currently empty — correct, no active KB)
- `/admin/label-evaluator/cosmetics/datasets` — Cosmetics KB admin, empty, upload will refuse any file until the parser exists

DB is `atlas_rcp` on local Postgres (`docker-compose.yml`'s `db` service, or however you're running it). No destructive commands were run against it this session beyond additive migrations + the seeded data already there.

---

## 3. Leftover state you should know about

- **One real fixture remains:** `ATL-2026-DEMO01` (SFDA_SUPPLEMENTS, status `ASSESSED`) — a synthetic request I created to prove the pipeline, still sitting in the DB, already promoted into its `RequestItem.assessment`. Harmless, but not real client data. Delete it (and its `LabelAssessment`) if it bothers you, or leave it as a live example.
- **Cosmetics has zero KB data** — this is *correct*, not a bug. A synthetic test KB (`cosmetics_TESTFIXTURE_...`) was created mid-session to prove the classifier/reclassify/required-tests/blocked-state UI, then **fully deleted** afterward, including its fixture request (`ATL-2026-COSDEMO`) and assessments. Verified via script: `LabelKbVersion` count for `COSMETICS` domain = 0.
- Two `RequiredDocument` rows (`PRODUCT_ARTWORK`, `INGREDIENT_LIST_INCI` on `SFDA-COS-001`) are real, pre-existing catalogue config — not fixture pollution, don't touch them.
- Dev server has been running the whole session; instrumentation started both cron workers (`notifications.cron` and `label-eval.cron`) cleanly with no errors in the log.

---

## 4. Real bugs found and fixed this session (so you don't reintroduce them)

1. **Field-model mismatch.** Originally split bilingual fields into two `LabelExtractedField` rows (`_en`/`_ar` suffixes) — contradicted the schema, which already carries both languages on one row. Fixed in `fields.ts`/`evaluators/registry.ts` before it went further. If you're adding new fields, one `fieldKey` = one logical field, always.
2. **Fingerprint scope.** Queue's `documentsFingerprint` was originally computed from "every mandatory document," which would've falsely triggered re-evaluation when a client updates an unrelated document (e.g. Certificate of Analysis). Fixed to scope exactly to `DOCUMENT_KIND_BY_REQUIRED_CODE[domain]` (`fields.ts`) — the actual artwork/ingredient-list docs the evaluator reads.
3. **i18n crash on duplicate upload.** `tErrors(code)` was called without the `{label}` param a message template required → hard Next.js error overlay. Fixed in `kb-datasets-panel.tsx` by parsing `CODE:detail` and passing `detail` as the param. **If you add more `CODE:detail`-shaped error strings, always pass the param through, even to templates that don't use it — next-intl ignores unused params but throws on missing ones.**
4. **Missing cosmetics decision translations.** Cosmetics uses `finalVerdict: "compliant"/"non_compliant"`, a different vocabulary than SFDA's `accepted/accepted_with_remarks/rejected/incomplete`. Both need entries in `labelEval.workspace.decision` (and `FINAL_VERDICT_TONE` in the component) — SFDA-only additions will silently render as untranslated keys for cosmetics.
5. **Over-broad "judgment" classifier.** The SFDA parser's first-pass regex flagged `GSO_9_01` ("Is the product name present?") as needing human judgment just because its `compliantWhen` text contained the word "clear." Fixed by requiring specific multi-word phrases, not generic adjectives. **If you touch `NEEDS_JUDGMENT` in `sfda-parser.ts`, re-run it against the real workbook and spot-check the classification distribution — don't trust a single keyword.**

---

## 5. Architectural things to not re-litigate

These were deliberate, verified-against-code decisions — don't redesign them without re-reading the "why" in the design doc:

- **No new `rbac.ts` permission.** Everything reuses `requests:admin` (evaluator actions) and `catalogue:manage` (KB admin) — both already cover exactly the right role sets.
- **No DB-touching test in the `npm test` glob.** CI has no Postgres service. The one exception is `classify.test.ts` — pure logic, no DB, safe. Any future test that needs Prisma must stay a manual/one-off script, not a `*.test.ts` file, until someone deliberately adds a Postgres service to `.github/workflows/ci.yml`.
- **`LabelAssessment.requestItemId` is optional + `SetNull`**, with `requestNo`/`organisationId`/`organisationName`/`serviceItemCode` snapshotted immutably. This was to survive client-side draft-cart deletion without breaking a live client flow. Don't make it required.
- **Documents are copy-on-ingest**, never referenced by the request's original `storageKey`. Clients can hard-delete request documents while in `DRAFT`/`RETURNED_TO_CLIENT`.
- **Promotion (`promoteToOfficialChecklist`) only exists for SFDA.** Cosmetics has no equivalent — `SFDA-COS-001`'s `ServiceItem.checkSets` has no items array, so there's nothing for a cosmetics promotion to write into. Don't add a promote button for cosmetics without first seeding a real cosmetics checklist on that service item.
- **`SFDA_FIELD_MAP` (sfda-field-map.ts) is a hand-curated, first-pass mapping**, not exhaustively SME-reviewed. It's honest about this in its own comments. If Ali/COC Manager reviews the actual 113 items, expect corrections here.
- **Cosmetics evaluators read `rule.payload.fieldKey` generically** rather than a hardcoded map like SFDA's — because there are no real cosmetics rule codes to hardcode against yet. Once the real cosmetics workbook exists, whether to *also* build a SFDA-style curated map is an open call, not a foregone conclusion.

---

## 6. Next steps, roughly in priority order

1. **Get the cosmetics workbook and the SFDA Tables 1/2 file from Atlas.** Nothing else is blocked on anything else — these are the two real external dependencies left.
2. Once the cosmetics workbook arrives: build `cosmetics-parser.ts` mirroring `sfda-parser.ts`'s approach (explicit per-sheet row/column anchors verified against the real file, never a generic "find the header" parser) — see design doc §7.2 for the *inferred* schema to reconcile against the real one, and §7.4 for why `exceljs` was chosen.
3. Wire real OCR: implement `GoogleVisionProvider`/`PaddleOcrVlProvider` bodies in `src/server/label-eval/extraction/provider.ts` (currently both just `throw`). Needs `@google-cloud/vision` added as a dependency and a service account — do that as its own deliberate step, not silently.
4. Product-owner decisions still open (design doc §12): cosmetics final-verdict formula (currently "any non-compliant label item fails," the stricter of two options, swappable in one function in `run-cosmetics.ts`), SFDA Critical-item policy (ships OFF), and whether to revisit LLM-proposed verdicts.
5. If real integration-test coverage is wanted beyond the one pure-logic test: add a Postgres service to CI first.

---

## 7. File map (for fast orientation)

```
prisma/schema.prisma                              — Label* models (search "Label Evaluator" section header)
prisma/migrations/202608121*/                      — the 3 migrations
scripts/import-sfda-kb.ts                          — reusable: npx tsx scripts/import-sfda-kb.ts <file.xlsx> [--activate]

src/server/label-eval/
  fields.ts                                         — per-domain field defs, document-kind mapping
  fingerprint.ts                                    — documentsFingerprint helper
  storage.ts                                        — copy-on-ingest
  concurrency.ts                                     — claim/take-over, guarded verdict override
  queries.ts                                         — all read queries (queue, assessment detail, KB versions)
  actions.ts                                         — all "use server" actions (start, confirm, override, promote, reclassify)
  extraction/provider.ts                             — ExtractionProvider interface + Manual/Google/PaddleOCR stubs
  extraction/worker.ts                               — outbox-style job drain
  jobs.ts                                            — cron registration (wired into src/instrumentation.ts)
  evaluators/registry.ts                             — EvaluatorFn type + dispatch
  evaluators/sfda.ts + sfda-field-map.ts              — SFDA's 6 evaluators
  evaluators/cosmetics.ts                             — cosmetics' 4 evaluators
  evaluators/run-sfda.ts / run-cosmetics.ts           — per-domain orchestration + scoring
  classification/classify.ts (+ .test.ts)             — cosmetics classifier, has a real unit test
  kb/sfda-parser.ts                                   — real, tested Excel parser
  kb/versioning.ts + kb/actions.ts                    — draft/diff/activate/rollback

src/components/atlas/label-eval/
  needs-evaluation-table.tsx
  assessment-workspace.tsx                            — the big one: gate, cards, classification, required tests, verdict bar
  kb-datasets-panel.tsx

src/app/[locale]/(admin)/admin/label-evaluator/
  sfda/page.tsx, sfda/[assessmentId]/page.tsx, sfda/datasets/page.tsx
  cosmetics/ (same shape)
```
