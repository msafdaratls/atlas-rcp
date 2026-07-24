# Deep Audit Fixes Implementation Plan

> **For agentic workers:** Execute all tasks without pausing. Do not skip findings.

**Goal:** Close every finding from the 2026-07-24 deep system flow audit.

**Architecture:** Tighten RBAC and auth first; then schema (ON_HOLD prior state, AuditLog.organisationId); then billing/storage/notifications/UI/i18n cleanup.

**Tech Stack:** Next.js 15, Prisma, Auth.js v5, Zod, next-intl, node:test via tsx for pure helpers.

## Global Constraints

- Arabic default / RTL logical CSS / next-intl for user strings / SAR Decimal money
- No `any`, no `console.log`, Server Actions + Zod + `requirePermission` + AuditLog
- Use `scopedDb(session)` for tenant queries
- Do not commit unless user asks

## Tasks

See conversation todos: C1–C3, H1–H10, M1–M12, L1–L4, verify.
