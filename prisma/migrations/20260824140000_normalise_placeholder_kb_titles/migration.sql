-- Clears placeholder English titles out of already-imported KB rules.
--
-- The GSO 2528 claims workbook writes a literal "0" — not a blank — into its
-- "Claim (English)" column for every General claim from CLAIM-GEN-3-2 onward,
-- while the Arabic column carries the real question. The parser now
-- normalises that on import (src/lib/bilingual-title.ts, applied in
-- cosmetics-parser.ts), but datasets imported before this migration still
-- hold the digit, and production will not be re-importing its active dataset.
--
-- Leaving it in place is not cosmetic: titleEn is read directly — with no
-- bilingual fallback — by the LLM judgment prompt
-- (src/server/label-eval/llm/judgment-proposals.ts) and by the staff
-- assistant's KB search (src/server/assistant/kb-search.ts). Once an
-- ANTHROPIC_API_KEY is configured, every affected claim would be sent to the
-- model with "0" as its English rule text.
--
-- Setting the column to NULL restores the fallback each consumer already
-- implements (`titleEn ?? titleAr`), so they read the genuine Arabic text
-- instead. No English text is invented and titleAr is never touched, so the
-- underlying translation gap stays visible to whoever reviews these rows.
--
-- Idempotent: re-running matches nothing once the values are NULL. Scoped to
-- exact placeholder tokens so no real title can be caught by it.

UPDATE "LabelKbRule"
SET "titleEn" = NULL
WHERE "titleEn" IS NOT NULL
  AND lower(btrim("titleEn")) IN ('0', '-', '—', 'n/a', 'null');
