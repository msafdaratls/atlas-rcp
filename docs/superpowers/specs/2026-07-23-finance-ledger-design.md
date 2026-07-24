# Atlas COC — Internal ledger finance design

**Date:** 2026-07-23  
**Status:** Approved  
**Decisions locked:** `LedgerEntry.reversesEntryId` for reversing corrections (option A)

## Scope

Client statement + admin finance. Internal ledger only — no tax authority, no payment gateway.

## Hard rule

`LedgerEntry` is append-only. Corrections are new reversing rows linked via `reversesEntryId`. No update/delete in the ledger service or repository.

## Balance

`balance = Σ debit − Σ credit`. Positive = client owes; negative = in credit.
