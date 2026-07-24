# Full System Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every finding from the 2026-07-24 full-system-audit canvas (C1–C3, H1–H14, M1–M14, L1–L4).

**Architecture:** Extract pure helpers with unit tests first (credit limit, SLA keys, rate limit, MIME sniff, due dates, statement opening balance, resubmission caps). Then wire Server Actions, API routes, RBAC, schema migration (`slaPausedAt`), and UI/i18n.

**Tech Stack:** Next.js 15, Prisma, Auth.js v5, Zod, next-intl, node:test via tsx.

## Global Constraints

- Arabic default / RTL logical CSS / next-intl for user strings / SAR Decimal money
- No `any`, no `console.log`, Server Actions + Zod + `requirePermission` + AuditLog
- Use `scopedDb(session)` for tenant queries
- Do not commit unless user asks

## Finding → Task map

| IDs | Task |
|-----|------|
| C1,C3,M1,M12,M13 | Task 1 Billing helpers + submit/resubmit locks |
| C2,H6,H7,M2,M9,L2 | Task 2 Cancel void, dueAt, allocations, coupons |
| H5,M10 | Task 3 Statement opening balance + API Zod |
| H1,H2,H12,H13,M6,M7,L4 | Task 4 Storage authz, MIME, SVG, AV |
| H3,H4,M4,M5 | Task 5 RBAC least privilege + middleware |
| H8,H9,H10,M8 | Task 6 SLA pause/dedupe + outbox reclaim |
| H11,H14,M11,M3,L3 | Task 7 Company last-owner, rate limit, invites, FSM lock, audits |
| M14,L1 | Task 8 i18n leftovers + tests |

---
