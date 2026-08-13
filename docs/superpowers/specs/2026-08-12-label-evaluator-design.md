# Atlas COC — Label Evaluator (SFDA Supplements + Cosmetics) design

**Date:** 2026-08-12 (rev. 3 — corrected after a self-audit found one fabricated finding and several unverified assumptions; see §0.4 for the correction log)
**Status:** Draft — pending owner sign-off on items marked `DECISION PENDING`
**Supersedes:** the original standalone "SFDA Dietary-Supplement Label Assessment Engine" spec.

**Decisions locked:**
- Shared engine, separate per-domain datasets (cosmetics and SFDA never share rules, lookups, or a classifier).
- Two separate pages, one per domain, inside `coc.atls.com.sa` — not a standalone app, not a panel inside `/admin/requests/{id}`.
- Client selection is a **queue of real open Requests**, never a free-text client picker (§2A).
- LLM may propose judgment-item verdicts; a human always decides (§1.2 — carries a documented caveat).
- Strictly additive: zero behavioral change to the existing portal (§13).
- Datasets are updated by **uploading Excel workbooks** — both domains' workbooks are being supplied by Atlas.
- Excel parsing uses **`exceljs`** (§7.4).
- The **"Promote to official checklist" bridge ships** — evaluator output can be written into `RequestItem.assessment` by an explicit human action, under the constraints in §13.3.

---

## 0. Evidence base — what was actually verified, and what was wrong

### 0.1 The live cosmetics tool has no "not a cosmetic" exit — confirmed, and it matters

A real dietary-supplement label (BEYAN HERBS PROPOLIS) was run through `cosmetics.atls.com.sa/tool`. The classifier **correctly identified that it is not a cosmetic** and said so explicitly in its own reason text:

> "المنتج عبارة عن مكمل غذائي… مما يخرجه تماماً من نطاق مستحضرات التجميل… **تم اختيار الفئة بشكل اضطراري للالتزام بالقائمة المسموحة**، لكن المنتج فعلياً لا يُصنف كمنتج تجميلي"
> *(…a food supplement… entirely outside the scope of cosmetics… **the category was chosen out of necessity to comply with the allowed list**, but the product is actually not a cosmetic.)*

It then picked `العناية بالفم` (Oral Care) anyway, ran the full GSO 1943 checklist, the COSING ingredient screen and the required-tests engine, and produced a confident `❌ Non-compliant`.

**The model was right; the system had nowhere to put a correct answer.** This is an architectural gap, not a model failure. The fix is a first-class "no confident match" state that halts the pipeline (§1.4), not better prompting.

### 0.2 What this repo already has

- `prisma/seed-assets/sfda-checksets.ts` — **113 SFDA items** (19 + 24 + 37 + 14 + 19), auto-generated from the workbook. Data-completeness audit in §7.1 — it is **not** uniformly usable.
- `src/lib/assessment.ts` — the exact workbook scoring formula, already correct and live.
- Both are wired to a **manual** checklist only. No extraction, OCR, LLM, or auto-verdict layer exists anywhere in this repo. That entire layer is new.

### 0.3 Verified facts about the existing portal (checked directly in code)

- `saveAssessment` (`src/server/admin/actions.ts:1374+`) is gated by `requirePermission(session, "requests:admin")` and `ASSESSMENT_EDIT_STATES = [ASSESSMENT_RUNNING, TECHNICAL_REVIEW, DECISION, REPORT_ISSUED]` (`:1358-1363`). It accepts **only** `COMPLIANT | NON_COMPLIANT | NA` and silently drops verdicts whose codes are absent from `serviceItem.checkSets`. Both constraints bind §13.3.
- `saveAssessment` writes `RequestItem.assessment` with an **unconditional** `prisma.requestItem.update` — no lock, no version check. Concurrent evaluators overwrite each other (last write wins). Pre-existing; out of scope to fix; must not be replicated (§13.1).
- `removeRequestDocument` (`src/server/requests/actions.ts:975-1005`) lets a **client** hard-delete a `RequestDocument`, all its `DocumentVersion` rows, **and the underlying storage files**, while in `DRAFT` or `RETURNED_TO_CLIENT`. Drives §3's copy-on-ingest rule.
- `createOrSelectDraft` (`src/server/requests/actions.ts:253`) hard-deletes `RequestItem` rows when a client changes cart selection. Drives §3's optional-FK design.
- `resubmitReturnedRequest` (`src/server/requests/actions.ts:1407-1714`) reuses the original `RequestItem`s, bumps `Request.submissionNo`, and routes `RETURNED_TO_CLIENT → UNDER_INTAKE_REVIEW` — it must then pass back through `completeApplicationReview` to reach `ASSESSMENT_RUNNING`. **`SUPPLEMENT_LABEL_REREVIEW` is an ordinary purchasable catalogue item, entirely unconnected to this flow.**
- `ASSESSMENT_QUEUED` is transient only — `completeApplicationReview` (`src/server/admin/actions.ts:566-710`) cascades straight to `ASSESSMENT_RUNNING` in one transaction. `ASSESSMENT_RUNNING` is the only real resting state.
- `RequestItem.assessment` is **never** cleared on resubmission or new document versions — stale prior-cycle data persists.
- No "assigned to me" worklist exists anywhere; queues filter by state only (`src/server/admin/queries.ts:140-178`).
- `playwright` is a **production** dependency and PDF generation already exists at `src/server/finance/pdf.ts` — reuse it (§10).
- There is **no** xlsx/exceljs dependency in the repo (§7.4).

### 0.4 Verified facts about the SFDA source workbook

`Food_Supplement_Label_Assesment.xlsx` was parsed directly (openpyxl, `data_only=True`). 8 sheets. Every structural quirk the original brief predicted is real:

- Scoring formula on `How to Use` matches our implementation word-for-word (rate, N/A excluded, 100 / ≥80 / <80 gates).
- Item counts are exactly **19 + 24 + 37 + 14 + 19 = 113**, and the main sheet's `→ See DB_… (Row N)` pointers resolve correctly to each DB sheet.
- `DB_SFDA-.FD 55` genuinely **lacks the `Knowledge Base (English)` column** (7 columns vs 8).
- `DB_SFDA FD 2233`'s priority-summary row has the predicted **cell offset** (`Critical:` → blank cell → `10`).
- `DB_Food Additives` row 25 carries a self-declared **gelatin data gap** (quoted in §7.1).

**The workbook is a manual instrument.** The main sheet is questions + a Compliant/Non-Compliant/N/A dropdown + a pointer to a DB row. `Compliant When` is prose written for a human evaluator, not machine-readable logic. Our evaluators *encode* that prose; they do not inherit executable rules from the file.

### 0.5 Correction log — a previous revision of this document was wrong

Rev. 1 claimed the live tool had an "extraction/assessment desync bug": that confirmed fields `Batch number = LOT 2024A1` and `PAO = 12M` coexisted with assessment cards reporting both as missing. **This was false.** A DOM inspection showed `value: ""` for both — `LOT 2024A1` and `12M` are HTML **placeholders**. The label itself prints blank templates (`Prod.:`, `Exp.:`, `Batch.:`, `الإنتاج :`, `الإنتهاء :`), which the original SFDA spec's Appendix C already documented: *"batch number & expiry printed as blank templates → those items correctly non_compliant."* The tool was correct.

Rev. 1 also reported the detected category as "Skin Care/Sunscreen/Peeling" — that was a mid-computation read while the page still displayed *"Classifying…"*. The settled result is Oral Care (§0.1).

**Retained anyway:** the principle in §1.3 (evaluators read confirmed fields, never re-derive from artwork) is good engineering and stays — but it is a design choice, not a fix for an observed defect, and its acceptance test has been rebound to a valid fixture (§11).

---

## 1. Non-negotiable principles

1. **Determinism for everything not explicitly LLM-assisted.** Presence/format/lookup evaluators are plain code: same confirmed inputs + same KB version ⇒ identical verdict, always.
2. **LLM may propose, never silently decide.** For judgment items (cosmetics claims semantics; SFDA wording items) an LLM may pre-fill a verdict + rationale, always carrying a visible "Change assessment" override; the stored verdict is whatever the human leaves. Every proposal logs model, prompt version, and KB version.
   > **⚠ Caveat, recorded deliberately.** The original project brief's founding premise was that the previous prototype *failed in production because an LLM produced verdicts*, making results non-deterministic — *"must NEVER decide the verdict."* Allowing LLM-proposed verdicts partially re-enters that territory. Mitigations: human override on every card, full provenance logging, and non-LLM items remain byte-deterministic. This trade is listed in §12 as revisitable.
3. **One confirmed-state boundary.** Once a reviewer clicks "Data confirmed — continue assessment," every downstream evaluator reads **only** the confirmed `LabelExtractedField` rows. Nothing downstream re-touches the raw artwork or silently re-runs extraction.
4. **A classifier must be able to refuse.** Cosmetics classification has an explicit low-confidence / not-a-cosmetic outcome that **halts** assessment with a clear message, never defaults to a nearest category. This is the direct fix for §0.1.
5. **Auditability.** Every verdict records KB version, rule, and the exact confirmed evidence text. Every report is a frozen, reproducible snapshot backed by artwork the evaluator owns (§3).
6. **Domains are hard-separated, not routed.** Two entry points, two datasets, two rule sets; cosmetics has a classifier, SFDA has none. There is no shared "detect the domain" step — the reviewer's choice of page *is* the domain. This makes §0.1's failure mode structurally impossible here.
7. **Integrate identity/storage/roles, not workflow.** Reuse `Organisation`, `User`/`Role`/RBAC, `StorageAdapter`, `AuditLog`. Do not participate in `RequestState` transitions.

---

## 2. Shared architecture

One app, one pipeline shape, parameterised by `domain: "SFDA_SUPPLEMENTS" | "COSMETICS"`. Domain-specific stages are separate registered modules, not `if (domain === …)` branches buried in shared functions.

```
Reviewer opens one of two pages ("SFDA Supplement Evaluator" / "Cosmetics Evaluator")
   │
   1. Pick a RequestItem from that domain's "Needs Evaluation" queue (§2A).
   │        Client/org identity is DERIVED from the request — never entered.
   │
   2. Copy the artwork (+ ingredient list, cosmetics) already attached to that
   │        RequestItem into evaluator-owned storage (§3), then run extraction
   │        as an async job. Arabic + low-confidence fields flagged needsReview.
   │
   3. VERIFICATION GATE ── reviewer edits/confirms; "Data confirmed — continue".
   │        Blocked until every mandatory fieldKey is non-empty, and blocked if
   │        the source documents changed since extraction (§13.5).
   │
   4. [Cosmetics only] Classification against confirmed fields + ingredients.
   │        "No confident match" ⇒ BLOCKED_NO_CATEGORY_MATCH, hard stop (§1.4).
   │        Reviewer may Reclassify (logged manual override).
   │
   5. Rule engine (domain-specific evaluator set) reads ONLY confirmed fields
   │        (+ confirmed classification for cosmetics).
   │
   6. Scoring — SFDA: workbook formula (§8.1). Cosmetics: DECISION PENDING (§8.2).
   │
   7. Report — frozen snapshot + PDF; optional promotion to the official
   │        checklist as a separate explicit human action (§13.3).
```

---

## 2A. Request selection — the "Needs Evaluation" queue

No free client picker. Every evaluation traces to a real, open, submitted COC `Request` — an assessment with no request behind it is not a defensible record for an accredited body.

### 2A.1 Queue definition (per domain, computed live)

```
NeedsEvaluation(domain) =
  RequestItem
    JOIN Request                   ON RequestItem.requestId
    JOIN LabelEvalServiceMapping   ON RequestItem.serviceItemId   -- explicit opt-in list
  WHERE LabelEvalServiceMapping.domain = :domain
    AND Request.state = 'ASSESSMENT_RUNNING'      -- the only real resting state (§0.3)
    AND NOT EXISTS (
          SELECT 1 FROM LabelAssessment la
          WHERE la.requestItemId = RequestItem.id
            AND la.status = 'ASSESSED'
            AND la.documentsFingerprint = <live fingerprint for this item>
        )
  ORDER BY Request.slaDueAt ASC NULLS LAST
```

`documentsFingerprint` is a **single scalar** — `sha256(sorted(current DocumentVersion sha256s for this item's mandatory docs))` — not an array comparison, so it is trivially indexable and comparable. (Rev. 1 specified an array set-comparison that is impractical in Postgres/Prisma.)

This one query covers both cases you asked for, as a single list with a badge rather than two screens:
- **First submission** — no `LabelAssessment` exists for the item.
- **Resubmission / replaced artwork** — an assessment exists but the fingerprint differs.

Badge: **"Resubmission"** when `Request.submissionNo > 1`, else **"First submission"** — display only. Filtering is purely fingerprint-based, which stays correct even if `submissionNo` semantics ever change, and requires no hook into `resubmitReturnedRequest`.

### 2A.2 Access & scope

- Gate on the existing `requests:admin` permission — same visibility as today's admin request list. No new role.
- Optional **"assigned to me"** filter (`Request.assignedToUserId === session.userId`). Label it as new in the UI; nothing equivalent exists today (§0.3).
- Items whose parent `Request` is `ON_HOLD` / `RETURNED_TO_CLIENT` never appear, and state is **re-verified at open time**, not only at list time (§13.5).
- Only `ServiceItem`s present in `LabelEvalServiceMapping` appear. A bundled request containing one SFDA item and one cosmetics item surfaces each on its own page only (§13.6).

---

## 3. Data model (new Prisma models — additive)

```prisma
enum LabelEvalDomain      { SFDA_SUPPLEMENTS  COSMETICS }
enum LabelKbStatus        { DRAFT  ACTIVE  ARCHIVED }
enum LabelDocumentKind    { ARTWORK  INGREDIENT_LIST }

enum LabelRuleType {
  CHECKLIST_ITEM           // SFDA: all 113 items
  LABEL_REQUIREMENT_ITEM   // Cosmetics: GSO 1943 presence/format
  CLAIM_PHASE_ITEM         // Cosmetics: GSO 2528 claims-judgment framework
  REQUIRED_TEST_RULE       // Cosmetics: SFDA Tests v4.0 triggers
}

enum LabelAssessmentStatus {
  EXTRACTING
  AWAITING_REVIEW
  CLASSIFYING                 // cosmetics only
  ASSESSED
  BLOCKED_NO_CATEGORY_MATCH   // cosmetics only — the explicit refusal state (§1.4)
  ERROR
}

enum LabelVerdict {
  COMPLIANT
  NON_COMPLIANT
  NA
  NEEDS_REVIEW                // LLM-proposed, awaiting human confirmation
  REQUIRES_ADDITIONAL_DATA    // needs formulation/lab/dossier input
}

model LabelKbVersion {
  id                String        @id @default(cuid())
  domain            LabelEvalDomain
  versionLabel      String
  sourceFilename    String
  uploadedByUserId  String
  uploadedAt        DateTime      @default(now())
  status            LabelKbStatus @default(DRAFT)
  activatedAt       DateTime?
  activatedByUserId String?
  checksum          String
  notes             String?

  rules       LabelKbRule[]
  lookups     LabelKbLookup[]
  categories  LabelKbCategory[]
  assessments LabelAssessment[]

  @@unique([domain, versionLabel])
  @@index([domain, status])
}

model LabelKbRule {
  id             String          @id @default(cuid())
  kbVersionId    String
  domain         LabelEvalDomain
  ruleType       LabelRuleType
  /// MUST equal the corresponding code in ServiceItem.checkSets (e.g. "GSO_9_01")
  /// wherever promotion (§13.3) is intended — saveAssessment silently drops
  /// verdicts whose codes are absent from the service checklist.
  code           String
  section        String?
  titleEn        String?
  titleAr        String
  priority       String?         // null for 33 SFDA items — see §8.1
  evaluatorKey   String
  /// Rule-type-specific fields. SFDA GSO_9/FD_55/FD_2233 carry `compliantWhen`;
  /// FD_2333/FD_2500 instead carry `decisionRule` + `referenceRange` +
  /// `applicability` (§7.1). Cosmetics shapes per §7.2.
  payload        Json            @default("{}")
  autoVerifiable Boolean         @default(true)

  kbVersion LabelKbVersion     @relation(fields: [kbVersionId], references: [id], onDelete: Cascade)
  verdicts  LabelItemVerdict[]

  @@unique([kbVersionId, code])
  @@index([kbVersionId, ruleType])
}

model LabelKbLookup {
  id          String          @id @default(cuid())
  kbVersionId String
  domain      LabelEvalDomain
  tableKey    String          // health_claims_table1, food_additives_13_6, cosing_annex_ii, …
  payload     Json

  kbVersion LabelKbVersion @relation(fields: [kbVersionId], references: [id], onDelete: Cascade)

  @@index([kbVersionId, tableKey])
}

/// Cosmetics only — the category taxonomy driving claims scope and test rules.
model LabelKbCategory {
  id          String          @id @default(cuid())
  kbVersionId String
  domain      LabelEvalDomain
  code        String
  nameEn      String
  nameAr      String
  icon        String?
  properties  Json            @default("[]")
  sortOrder   Int             @default(0)

  kbVersion LabelKbVersion @relation(fields: [kbVersionId], references: [id], onDelete: Cascade)

  @@unique([kbVersionId, code])
}

/// Explicit admin-managed opt-in list. NOT a code/name pattern match — this is
/// what keeps GHAD/FASAH/SCOC services out of the evaluation queue.
model LabelEvalServiceMapping {
  id            String          @id @default(cuid())
  serviceItemId String          @unique
  domain        LabelEvalDomain

  @@index([domain])
}

/// One row per evaluation RUN. A resubmission with new artwork creates a NEW
/// row; prior runs are never overwritten.
model LabelAssessment {
  id          String          @id @default(cuid())
  domain      LabelEvalDomain
  kbVersionId String          // stamped at run start, immutable

  /// Optional + SetNull: clients can hard-delete RequestItems from a draft
  /// cart (§0.3). A required FK would make that delete throw and break a live
  /// client flow; Cascade would destroy certification records. The snapshot
  /// fields below keep this row self-contained and auditable if the link dies.
  requestItemId String?
  requestNo        String       // immutable snapshot
  organisationId   String       // immutable snapshot
  organisationName String       // immutable snapshot
  serviceItemCode  String       // immutable snapshot

  /// sha256 of the sorted sha256s of the source documents this run used.
  /// Scalar, indexable — drives the §2A.1 needs-(re)evaluation check.
  documentsFingerprint String

  createdByUserId   String
  status            LabelAssessmentStatus @default(EXTRACTING)
  createdAt         DateTime              @default(now())
  updatedAt         DateTime              @updatedAt
  confirmedAt       DateTime?
  confirmedByUserId String?
  finalVerdict      String?
  overallRate       Float?                // SFDA only
  /// Soft claim so two reviewers don't unknowingly duplicate work (§13.4).
  claimedByUserId   String?
  claimedAt         DateTime?

  kbVersion      LabelKbVersion        @relation(fields: [kbVersionId], references: [id])
  requestItem    RequestItem?          @relation(fields: [requestItemId], references: [id], onDelete: SetNull)
  documents      LabelDocument[]
  fields         LabelExtractedField[]
  classification LabelClassification?
  verdicts       LabelItemVerdict[]
  requiredTests  LabelRequiredTest[]
  report         LabelReport?

  @@index([domain, requestItemId, createdAt])
  @@index([status])
  @@index([requestItemId, status])
  @@index([documentsFingerprint])
}

/// COPY-ON-INGEST, NOT A REFERENCE. Clients can hard-delete RequestDocuments
/// and their storage files while in DRAFT/RETURNED_TO_CLIENT (§0.3). If this
/// model pointed at the request's storageKey, a client could destroy the
/// artwork underpinning a completed assessment's audit trail. The evaluator
/// copies each file to its own key under an evaluator-owned prefix and never
/// deletes it.
model LabelDocument {
  id               String            @id @default(cuid())
  assessmentId     String
  kind             LabelDocumentKind
  /// Provenance only — may dangle if the client later removes the original.
  sourceDocumentVersionId String?
  fileName         String
  mimeType         String
  sizeBytes        Int
  storageKey       String            // evaluator-owned copy
  sha256           String
  copiedAt         DateTime          @default(now())

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@index([assessmentId])
  @@index([sha256])
}

model LabelExtractedField {
  id                   String    @id @default(cuid())
  assessmentId         String
  fieldKey             String
  valueEn              String?
  valueAr              String?
  sourceEngine         String    // paddleocr_vl | google_vision | manual
  confidence           Float?
  needsReview          Boolean   @default(false)
  originalMachineValue Json?     // pre-edit values, for audit
  confirmedByUserId    String?
  confirmedAt          DateTime?

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@unique([assessmentId, fieldKey])
}

/// Cosmetics only.
model LabelClassification {
  id                   String    @id @default(cuid())
  assessmentId         String    @unique
  detectedCategoryCode String?
  detectedConfidence   Float?
  /// Set true when the classifier judged the product out of domain entirely.
  notApplicable        Boolean   @default(false)
  overrideCategoryCode String?
  overriddenByUserId   String?
  overriddenAt         DateTime?
  rationale            String?

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
}

model LabelItemVerdict {
  id                 String        @id @default(cuid())
  assessmentId       String
  kbRuleId           String
  verdict            LabelVerdict
  autoOrManual       String        // auto | llm_proposed | manual_override
  evidenceText       String?
  rationale          String?
  llmModel           String?
  llmPromptVersion   String?
  overriddenByUserId String?
  overriddenAt       DateTime?
  previousVerdict    LabelVerdict?

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)
  kbRule     LabelKbRule     @relation(fields: [kbRuleId], references: [id])

  @@unique([assessmentId, kbRuleId])
}

/// Cosmetics only.
model LabelRequiredTest {
  id            String  @id @default(cuid())
  assessmentId  String
  testCode      String
  mandatory     Boolean @default(true)
  ruleCode      String  // e.g. RULE-SFDA-TEST-060
  reasonEn      String?
  reasonAr      String?
  triggerSource String?
  addedManually Boolean @default(false)

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id], onDelete: Cascade)

  @@index([assessmentId])
}

model LabelReport {
  id             String   @id @default(cuid())
  assessmentId   String   @unique
  generatedAt    DateTime @default(now())
  pdfStorageKey  String?
  snapshot       Json     // frozen: fields + verdicts + classification + kbVersion
  promotedAt     DateTime?          // set when §13.3 promotion ran
  promotedByUserId String?

  assessment LabelAssessment @relation(fields: [assessmentId], references: [id])
}
```

**Reused read-only:** `Request`, `RequestItem`, `RequestDocument`, `DocumentVersion`, `Organisation`, `User`.
**Reused for writes:** `AuditLog` only (standard additive usage).
**Only touch to an existing model:** a `labelAssessments LabelAssessment[]` back-relation on `RequestItem` — a Prisma relation field, no new column, no data migration.

---

## 4. Roles (reuse the existing `Role` enum — no new roles)

| Action | Roles |
|---|---|
| Open queue, run extraction, confirm fields, override verdicts, reclassify | `EVALUATOR`, `TECHNICAL_REVIEWER`, `SYSTEM_ADMIN` (gate: existing `requests:admin`) |
| Promote to official checklist (§13.3) | same as above — enforced by `saveAssessment`'s own `requests:admin` + `ASSESSMENT_EDIT_STATES` checks |
| Upload / diff / activate / rollback a KB version | `CATALOGUE_MANAGER`, `SYSTEM_ADMIN` |
| Read-only reports & history | reuses `requests:admin` — `REQUESTS_ADMIN_ROLES` (`src/lib/rbac.ts`) already includes `QUALITY_MANAGER`, so a separate `label_eval:read` permission would be redundant (implemented: **zero changes to `rbac.ts`**, see Implementation Log) |

---

## 5. Async extraction — reuse the existing job pattern

No BullMQ/Inngest exists — only a DB outbox + `node-cron` poller (`src/server/notifications/jobs.ts`, `worker.ts`, `npm run jobs`) and OS crontab for ops (`deploy/backup-db.sh`). Match that shape:

- `LabelExtractionJob` (outbox-style: `PENDING|PROCESSING|DONE|FAILED`, `attempts`, `nextAttemptAt`, `lastError`), written in the same transaction as the document copy.
- Drain it with a sibling worker under `src/server/label-eval/`, modelled on `processOutboxBatch`.
- The UI polls `LabelAssessment.status`; no HTTP request ever blocks on extraction (the original brief's 100 s gateway-timeout failure mode).

---

## 6. Evaluator registry

```ts
type EvaluatorFn = (
  confirmedFields: Record<string, { en?: string; ar?: string }>,
  classification: { categoryCode?: string; properties?: string[] } | null, // cosmetics only
  rule: LabelKbRule,
  lookups: LabelKbLookupIndex,
) => { verdict: LabelVerdict; evidenceText?: string; rationale?: string };
```

Keyed by `evaluatorKey`. Shared module; each domain registers only its own keys.

**SFDA keys:** `presence`, `format`, `bilingual_presence`, `lookup`, `wording_judgment` (LLM-proposed), `requires_additional_data`.

> **Mapping caveat (§7.1):** the source workbook uses two different DB schemas. GSO_9, FD_55 and FD_2233 (80 items) carry `compliantWhen`; FD_2333 and FD_2500 (33 items) carry `decisionRule` / `referenceRange` / `applicability` instead, and are predominantly `lookup` or `requires_additional_data` evaluators. Two mapping passes are required, not one.
>
> **`lookup` evaluators must fail safe.** Per the workbook's own gelatin note (§7.1), a lookup miss is never evidence of compliance *or* of non-compliance — it yields `REQUIRES_ADDITIONAL_DATA` with the reference range and evidence-required text attached. This is shared evaluator behaviour, not a per-item exception.

**Cosmetics keys:** `label_presence`, `label_format`, `claim_phase_judgment` (LLM-proposed, gated on a *confirmed* category — never a guessed one), `ingredient_lookup` (COSING Annex II/III), `required_test_rule` (fully deterministic, no LLM).

---

## 7. Datasets

Atlas is supplying the source Excel workbooks for **both** domains. All parsing is workbook-driven; nothing is hardcoded.

### 7.1 SFDA — the workbook has **two different DB schemas**, and one incomplete lookup

Verified against the source workbook, not inferred. The five DB sheets fall into two families:

**Family A — `DB_SFDA - FD. GSO 9`, `DB_SFDA-.FD 55`, `DB_SFDA FD 2233` (80 items)**
`Verification Item │ KB (English)* │ KB (Arabic) │ Category │ Evidence Required │ Compliant When │ Common Non-Conformities │ Priority`
*\* absent in FD 55 — that sheet is Arabic-KB only.*

**Family B — `DB_Food Additives`, `DB_Health and Nutrition Claims` (33 items)**
`Section Item │ Verification Item │ Source Rule (Arabic) │ Reference Range │ Applicability / Search Key │ Evidence Required │ Decision Rule`

Family B has **no `Compliant When` and no `Priority` columns at all.** This is a property of the source, not of our import: `prisma/seed-assets/sfda-checksets.ts` faithfully reproduces both shapes, and nothing was lost in translation. Field availability per section:

| Section | Items | `compliantWhen` | `priority` | `knowledgeBaseEn` |
|---|---:|:---:|:---:|:---:|
| GSO_9 | 19 | ✅ | ✅ | ✅ |
| FD_55 | 24 | ✅ | ✅ | ❌ (none in source) |
| FD_2233 | 37 | ✅ | ✅ | ✅ |
| FD_2333 | 14 | ❌ (no such column) | ❌ | ❌ |
| FD_2500 | 19 | ❌ (no such column) | ❌ | ❌ |
| **Total** | **113** | **80** | **80** | **56** |

Consequences the build must handle explicitly:
- Two evaluator-mapping passes, not one: `compliantWhen` for Family A; `decisionRule` + `referenceRange` + `applicability` for Family B.
- 57 items have no English KB. Render the Arabic KB with an explicit "English KB not provided for this item" note — never a blank panel.
- Priorities can never be backfilled from this workbook (§8.1).

**Lookup completeness — one section is whole, the other is not:**

| Sub-table | Declared in sheet | Actually present | Status |
|---|---:|---:|---|
| `DB_Food Additives` → Category 13.6 permitted additives | 49 | **49** | ✅ complete |
| `DB_Food Additives` → GMP additives identity | 183 | **183** | ✅ complete |
| `DB_Health and Nutrition Claims` → Table 1 (health claims) | 376 | **10** | 🔴 sample only |
| `DB_Health and Nutrition Claims` → Table 2 (nutrition claims) | 50 | **28** | 🔴 sample only |

Both claims tables terminate in an explicit placeholder row — `… │ See Table 1 for complete list of 376 permitted health claims │ Table 1!A1:R376` — pointing at sheets named `Table 1` / `Table 2` that **do not exist in this workbook**. Section 4 items 10–13 require exact matching against them ("*Compliant only when health claim matches Table 1*"), so **those 4 items cannot be automated until the file containing Tables 1 and 2 is supplied** (§12). Until then they emit `REQUIRES_ADDITIONAL_DATA` with the reference range attached — never a guessed verdict.

Food Additives' `Food additive` / `GMP All Additives` / `SFDA-FD-2500` references are internal; that data is reproduced in the sheet's own sections B and C, so Section 5's lookups are fully buildable today.

**The workbook's own gelatin note sets the standard the engine is held to** (`DB_Food Additives` row 25):

> *"Gelatin is referenced by Section 5 Item 5, but no Gelatin record was found in the current GMP All Additives source (A5:E187). **Do not conclude compliance from database absence**; obtain supplier origin, halal/animal-source documentation, and verify against the applicable regulatory source."*

Absence of a lookup record must always yield `REQUIRES_ADDITIONAL_DATA`, never `COMPLIANT` and never `NON_COMPLIANT`. Encode this as a shared rule in the `lookup` evaluator, not as a per-item special case.

Import path: seed SFDA `kb_v1` from `sfda-checksets.ts` (all 113 items, both shapes) and load Section 5's 49 + 183 lookup records from the workbook. Section 4's claim tables remain pending their source file.

### 7.2 Cosmetics — parse from the supplied workbook

Expected content, inferred from the live tool and to be reconciled against the actual file on first upload (the parser validates the sheet contract and hard-fails on mismatch rather than guessing):

| Content | Feeds |
|---|---|
| ~16-category taxonomy + properties (Cream/Sunscreen/Peeling/…) | `LabelKbCategory` |
| GSO 1943 label requirements (items 5.1–5.9 observed) | `LabelKbRule` (`LABEL_REQUIREMENT_ITEM`) |
| GSO 2528 claims framework (7 phases, items 1.1–7.4 observed) | `LabelKbRule` (`CLAIM_PHASE_ITEM`) |
| Per-category claim banks (~49 claims for skin care observed) | `LabelKbLookup` (`claims_bank_{code}`) |
| COSING Annex II (prohibited) / Annex III (restricted) | `LabelKbLookup` |
| SFDA Tests v4.0 trigger rules (`RULE-SFDA-TEST-0xx` observed) | `LabelKbRule` (`REQUIRED_TEST_RULE`) |

### 7.3 Versioning mechanics (shared)

Upload → parse → create `DRAFT` version → **validate & diff** vs. the current `ACTIVE` of the same domain (added / removed / changed items; hard-fail on missing sheet, shifted columns, or absent required values) → admin activates atomically (`DRAFT→ACTIVE`, prior `ACTIVE→ARCHIVED`) → historical `LabelAssessment` rows keep their stamped `kbVersionId` forever and are never re-scored → rollback = re-activate an archived version.

Admin UI: `/[locale]/(admin)/admin/label-evaluator/{domain}/datasets`. `CATALOGUE_MANAGER` / `SYSTEM_ADMIN` only.

### 7.4 Parser implementation — `exceljs` (locked)

No xlsx library existed in this repo; **`exceljs`** is the chosen dependency. Rationale: actively maintained, TypeScript-native, streaming-capable, and it keeps parsing in-process with the rest of the server code — no second runtime added to the Docker image, unlike a Python/`openpyxl` sidecar.

Parser requirements, independent of library:
- The **per-sheet column-mapping table is explicit and unit-tested**. A single generic parser silently misaligns columns on this workbook and is not acceptable.
- Known data quirks are **facts about the source, not parser bugs**, and must surface as named warnings on the diff screen rather than being silently dropped: FD_55's absent English-KB column; the multi-part lettered sub-table sheets (`DB_Food Additives`, `DB_Health and Nutrition Claims`); the FD 2233 priority-summary cell offset; the self-declared missing gelatin GMP record.
- Read with cell values resolved (formula results, not formulae), and quote sheet names containing special characters exactly as they appear.
- Any sheet/column contract violation **hard-fails the upload** and creates no partial `LabelKbVersion`.

---

## 8. Scoring

### 8.1 SFDA — reuse the existing, already-correct implementation

`src/lib/assessment.ts` already implements this exactly; call it rather than reimplementing.

```
rate = compliant / (compliant + nonCompliant)     // na + requires_additional_data excluded
rate == 1.0  → accepted
rate >= 0.8  → accepted_with_remarks
else         → rejected
```

`requires_additional_data` items block an auto-asserted "Accepted" — the reviewer resolves them first.

**`DECISION PENDING` — Critical-item policy.** The workbook contains no rule that a Critical failure blocks acceptance; adding one is policy, not engineering. Ship as `critical_policy_enabled`, default **OFF**, recording `criticalPolicyApplied` per assessment.
> **Permanent data gap — not an oversight to be fixed upstream.** 33 of 113 items (all of FD_2333 and FD_2500) have **no `priority` value**, because those two DB sheets have **no Priority column at all** (§7.1). A newer workbook will not supply it unless SFDA restructures those sheets. The policy must therefore define explicitly how unprioritised items are treated — treat-as-Critical, treat-as-non-blocking, or exclude from the policy — before the flag can be enabled. This is part of open decision #2.

### 8.2 Cosmetics — `DECISION PENDING`, formula not observable

The live tool exposes only a binary final verdict; one test run (2 non-compliant label items ⇒ `❌ Non-compliant`) cannot distinguish a threshold gate from single-strike. Do not guess. Options for the owner:
- Mirror SFDA's rate gate over label-requirement items, with claims as a separate informational panel.
- Any single `NON_COMPLIANT` label-requirement item ⇒ overall non-compliant.

Keep `finalVerdict` behind a named, swappable function so this is a one-function change, not a schema change.

---

## 9. UI

Two entry points:
- `/[locale]/(admin)/admin/label-evaluator/sfda`
- `/[locale]/(admin)/admin/label-evaluator/cosmetics`

Shared shell: **Needs-Evaluation queue** (SLA-sorted, First-submission/Resubmission badge, optional assigned-to-me filter) → open item (client/service shown read-only from the request) → extraction status → **extracted fields with a Missing-fields banner and per-field needs-review flags** → *(cosmetics: classification block with plain-language reasoning, Reclassify, and a distinct blocked state)* → assessment cards grouped by section/phase with per-group counts, each card showing rule code + standard + evidence quote + "Change assessment" → *(cosmetics: required-tests table with rule-ID justifications)* → final verdict bar → New Evaluation / Show Report / Print / Save / **Promote to official checklist** (§13.3).

Match existing tokens: `--atlas-green` `#519e53`, `--ink-800` `#252821`, shadcn/Radix, RTL-aware, **Montserrat / MontserratArabic** (this repo has no Tajawal). Default locale is Arabic.

---

## 10. Security & ops

- Google Cloud Vision service-account credentials and any LLM keys are **server-side only** — no key reaches a client bundle. All calls run inside server actions or the extraction worker.
- **PDF generation reuses `src/server/finance/pdf.ts`** (playwright, already a production dependency). Do not add a second PDF stack.
- Cache extraction by document `sha256` — never re-OCR an unchanged file.
- Cost guards with alert thresholds: Google Vision (free tier ~1,000 units/month) and LLM claim-assist calls.
- `AuditLog` entry for every: document ingest, field confirm, verdict override, classify/reclassify, KB upload/activate/rollback, and promotion to the official checklist.

---

## 11. Acceptance criteria

**Correctness & determinism**
- Re-running a domain's rule engine over the same confirmed fields + same KB version yields identical verdicts for every non-LLM evaluator. LLM-proposed items are exempt from byte-equality but must log model + prompt version + KB version, and the human-confirmed verdict must be reproducible from stored rows.
- Every `LabelItemVerdict` carries its `kbRuleId` and matched `evidenceText`; every `LabelAssessment` carries an immutable `kbVersionId`.
- SFDA's external-data items always surface as `REQUIRES_ADDITIONAL_DATA` — never a fabricated pass/fail.
- Scoring matches `src/lib/assessment.ts` exactly; the Critical policy changes output only when explicitly enabled.

**Confirmed-state boundary** *(design requirement — note: the earlier claim of an observed production desync bug was withdrawn, §0.4)*
- Given a fixture where a mandatory field **is** confirmed non-empty, no `presence`/`format`/`label_presence`/`label_format` evaluator may return `NON_COMPLIANT` on grounds of that fact being absent. Bind this to a fixture with populated values — **not** the BEYAN HERBS PROPOLIS label, whose batch/expiry fields are genuinely blank templates and correctly yield `NON_COMPLIANT`.
- A companion test asserts the converse on the BEYAN HERBS fixture: blank batch number and blank expiry/PAO **must** yield `NON_COMPLIANT`. This pins the true behaviour and prevents a future "fix" from breaking it.
- No verdict may be produced from unconfirmed Arabic OCR — the gate is enforced before any evaluator runs.

**Classifier refusal**
- A non-cosmetic (or low-confidence) input must land in `BLOCKED_NO_CATEGORY_MATCH` with no verdicts, no required tests, and no final verdict — never a nearest-category guess. Test with the BEYAN HERBS supplement fixture, and assert the SFDA pipeline (no classifier) processes the same file normally.

**Datasets**
- Upload → diff → atomic activate works per domain independently; historical assessments keep their `kbVersionId` and stored verdicts unchanged.
- A workbook violating the sheet contract fails with a specific, actionable error and creates no partial version.
- Known data gaps (FD_55 English KB, FD_2333/FD_2500 priorities, gelatin GMP record) surface as named warnings on the diff screen.

**Non-regression — the hard requirement**
- The full existing lifecycle (submit → intake → accept → assess → technical review → decision → report → close), resubmission, draft cart editing, and client document removal all behave identically before and after this feature ships. Existing test suite passes unmodified.
- The migration adds **no column to any existing table**.
- Deleting a draft `RequestItem` and removing a `RequestDocument` both still succeed when a `LabelAssessment` exists (verifies the `SetNull` FK and copy-on-ingest design).
- A completed assessment's report still renders after the client deletes the original source document (verifies audit-evidence durability).

**Concurrency**
- Two reviewers cannot silently clobber each other on the same `RequestItem` (§13.4).

**Security**
- No secret or API key appears in any client bundle.

---

## 12. Open decisions — do not silently resolve

| # | Decision | Owner | Blocking |
|---|---|---|---|
| 1 | Cosmetics final-verdict formula (§8.2) | Product owner | Milestone 5 |
| 2 | Critical-item policy, **and** how unprioritised FD_2333/FD_2500 items are treated (§8.1) | Ali / COC Manager | Only the flag; ships OFF |
| 3 | Revisit LLM-proposed verdicts (§1.2) against the original brief's determinism premise | Product owner | Non-blocking |

**Outstanding input dependency (not a decision — a missing file):**
- **Tables 1 & 2 for SFDA health/nutrition claims.** `DB_Health and Nutrition Claims` declares 376 health claims and 50 nutrition claims but contains only 10 and 28 samples, pointing at `Table 1` / `Table 2` sheets absent from the workbook (§7.1). Section 4 items 10–13 stay `REQUIRES_ADDITIONAL_DATA` until Atlas supplies that file. Everything else in the SFDA track is unblocked.

**Resolved since rev. 3:**
- *Excel parser library* → **`exceljs`** (§7.4).
- *Promotion bridge* → **ships**, under §13.3's constraints.
- *Verdict-enum mapping for promotion* → **resolved by design: omit, never coerce.** `saveAssessment` accepts only `COMPLIANT/NON_COMPLIANT/NA`, so `NEEDS_REVIEW` and `REQUIRES_ADDITIONAL_DATA` are left unwritten (the item stays unscored and the checklist reports `INCOMPLETE`). Coercing them into a pass or fail would falsify a compliance record, so there is no defensible alternative — but flag it if you want different behaviour.

---

## 13. Non-breaking integration & edge cases

### 13.1 A pre-existing gap this feature must not inherit
`saveAssessment` overwrites `RequestItem.assessment` unconditionally — no lock, no version check; concurrent evaluators clobber each other, and the field is never cleared on resubmission. **Out of scope to fix.** But the new feature must not add a second fragile writer to that field: it never writes there automatically (§13.3) and gets its own concurrency protection (§13.4).

### 13.2 Hard write boundary
New code writes only the `Label*` tables plus `AuditLog`. It reads `Request`, `RequestItem`, `RequestDocument`, `DocumentVersion`, `Organisation`, `User`. It never calls `completeApplicationReview`, `transitionAdminRequest`, or `resubmitReturnedRequest`, and never triggers a state transition. No existing server-action file is modified — new actions live in `src/server/label-eval/`.

### 13.3 Promotion is manual, explicit, and constrained
Evaluator output is advisory until a reviewer clicks **"Promote to official checklist"**, which calls the existing, unmodified `saveAssessment` — inheriting its `requests:admin` gate, `ASSESSMENT_EDIT_STATES` window, and audit trail. Two hard constraints, verified in code:

1. **Enum narrowing.** `saveAssessment` accepts only `COMPLIANT | NON_COMPLIANT | NA`. `NEEDS_REVIEW` and `REQUIRES_ADDITIONAL_DATA` **cannot be promoted**. They must be *omitted* (leaving those items unscored, so `computeAssessment` reports `INCOMPLETE` and the reviewer must resolve them) — never coerced into a passing or failing verdict, which would falsify a compliance record.
2. **Code alignment.** `saveAssessment` silently drops verdicts whose codes are absent from `ServiceItem.checkSets`. `LabelKbRule.code` must therefore match those codes exactly (e.g. `GSO_9_01`). The promotion action must report how many verdicts were written vs. dropped, and refuse to promote if the drop count is non-zero.

**Confirmation step.** Because promotion writes into the record the Technical Reviewer acts on, the action shows a pre-flight summary before writing — how many items will be written, how many withheld as `NEEDS_REVIEW`/`REQUIRES_ADDITIONAL_DATA`, and whether any prior `RequestItem.assessment` data will be overwritten (it is never cleared automatically on resubmission, §13.1, so stale prior-cycle verdicts may be present). The reviewer confirms explicitly. `LabelReport.promotedAt`/`promotedByUserId` and an `AuditLog` entry record the act.

### 13.4 Concurrency — new, since nothing exists to reuse
- **Soft claim:** opening an item sets `claimedByUserId`/`claimedAt`; another reviewer opening it sees "Currently being evaluated by {name}" with a logged manual take-over — not a hard lock, since staff hand-offs are normal.
- **One in-flight run per item:** starting a new extraction is blocked while an assessment for the same `RequestItem` is `EXTRACTING`/`AWAITING_REVIEW`/`CLASSIFYING`; the reviewer resumes the existing run.
- **Guarded verdict writes:** overrides use `updateMany` with an expected-previous-verdict predicate (borrowing the `updateMany`-with-expected-state idiom already used for request transitions at `src/server/admin/actions.ts:333,616,859,989`) rather than blind overwrite.

### 13.5 Race conditions
- Queue listing and assessment-open independently re-check `Request.state === 'ASSESSMENT_RUNNING'`. If it changed in between, the open fails with "This request is no longer available for evaluation — current status: {state}".
- If a source document's current version changes while an assessment is `AWAITING_REVIEW`, the live fingerprint no longer matches `documentsFingerprint`; the UI blocks "Data confirmed" and prompts a re-extract, so no reviewer confirms fields drawn from a superseded file.
- If a client deletes a source document mid-review, the evaluator's **copy** still exists (§3), so the run remains auditable; the UI shows a provenance warning that the original was removed.
- If a newer `LabelKbVersion` is activated mid-review, the in-progress run keeps its stamped version (never silently swapped) and shows: "A newer {domain} dataset is now active — restart this evaluation against it?" Finishing against a superseded regulation is itself a compliance risk, so it is surfaced rather than hidden.

### 13.6 Multi-item and multi-domain requests
A single `Request` may bundle items across sub-categories. The queue filters at `RequestItem` level via `LabelEvalServiceMapping`, so each item appears only on its own domain's page. Evaluating one item implies nothing about another's readiness or verdict, and the request itself is never "claimed" by a domain.

---

## 14. Implementation log — Milestone 1 (2026-08-12)

Two decisions made during implementation, deviating from earlier text in this document. Both narrow the footprint further, consistent with §13.2's minimal-touch principle — recorded here rather than silently, per this project's standing rule.

**No new rbac.ts permission.** §4 originally called for adding `label_eval:read`. On inspection, `REQUESTS_ADMIN_ROLES` (`src/lib/rbac.ts`) already equals exactly `[INTAKE_OFFICER, EVALUATOR, TECHNICAL_REVIEWER, DECISION_MAKER, SYSTEM_ADMIN, QUALITY_MANAGER]` — the same role set the design calls for, `QUALITY_MANAGER` included. Adding a second, functionally-identical permission would be redundant rbac.ts surface for no behavioral gain. **Implemented: all label-eval server code gates on the existing `requests:admin` permission; `catalogue:manage` for the (not-yet-built) KB admin surface. Zero lines changed in `rbac.ts`.**

**No DB-touching file added to the `*.test.ts` glob.** `.github/workflows/ci.yml`'s `test` job runs `npm test` with no Postgres service provisioned. Every existing test in this repo is a pure-function unit test for exactly this reason — none import `@/lib/db`. Adding a persistent integration test that does would make `npm test` fail in CI on every future run, which is itself a regression this feature is bound not to cause (§11's non-regression criterion). **Instead:** the SetNull-FK and copy-on-ingest behavior was verified with a one-off script against the local dev database — creating a real draft Request/RequestItem/RequestDocument/DocumentVersion, a real `LabelAssessment` + `LabelDocument` referencing it, then replaying `removeRequestDocument`'s and `createOrSelectDraft`'s delete sequences and asserting the `LabelAssessment` survives with `requestItemId: null` and its copied `LabelDocument` intact — then deleted, leaving no residue. All four assertions passed. The script was not committed.

**Open follow-up, not resolved here:** if permanent integration-test coverage is wanted for this feature going forward, CI needs a Postgres service added to `ci.yml` first (a `services:` block, unrelated to this feature's own code) — flagging for a decision rather than adding CI infrastructure unasked.

**Verified in this milestone, against the real repo (not assumed):**
- Migration `20260812114808_add_label_evaluator_schema` contains zero `ALTER TABLE` statements against any pre-existing table — confirmed by reading the generated SQL before applying it.
- `LabelEvalServiceMapping` deliberately carries no Prisma `@relation`/FK to `ServiceItem` — `serviceItemId` is a plain, unconstrained column. This means `ServiceItem` itself was touched not at all, not even by an added foreign-key constraint. (Referential correctness is instead enforced by seeding the mapping from known `ServiceItem.code`s.)
- `prisma/seed.ts:882` confirms `SFDA-COS-001` ("Technical Label Assessment") is the only cosmetics service with `checkSets: [{ code: "GSO_1943", ... }]` — the other three (`SFDA-COS-002` SCOC, `-003` GHAD registration, `-004` FASAH certificate) were inspected and excluded, as planned.
- All 72 pre-existing tests pass unmodified after the migration.
