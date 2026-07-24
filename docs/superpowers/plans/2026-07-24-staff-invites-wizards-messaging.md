# Staff invites, wizards & messaging — Implementation Plan

> **For agentic workers:** Use subagent-driven-development or execute task-by-task. Steps use checkbox syntax.

**Goal:** Atlas staff invites, catalogue create (with required docs) + coupon create wizards, and CLIENT↔ATLAS request messaging with COMMENT_ADDED notify.

**Architecture:** Extend existing admin/company patterns — new server actions in `src/server/admin/` and `src/server/requests/`, UI panels under `src/components/atlas/admin/` and request detail composers. No schema migrations.

**Tech Stack:** Next.js 15, Prisma, Zod, next-intl, Server Actions, existing atlas UI.

## Global Constraints

- Arabic default, RTL logical CSS only (`ms-`/`me-`/`ps-`/`pe-`, never `ml`/`left`)
- Strings via next-intl; update `src/messages/{ar,en}.json`
- Mutations: Zod + `requirePermission` + AuditLog; money as Prisma Decimal
- No `any`, no `console.log`, no git commit unless user asks
- Brand tokens from globals.css

---

### Task 1: RBAC + Atlas staff invite actions

**Files:**
- Modify: `src/lib/rbac.ts` — add `staff:manage` → SYSTEM_ADMIN only
- Modify: `src/server/admin/actions.ts` — invite/updateRole/deactivate
- Modify: `src/server/admin/queries.ts` — `listAtlasStaff`
- Modify: message files — `adminOps.settings.staff.*`, Atlas role labels

- [x] Add `staff:manage` to `requirePermission`
- [x] `listAtlasStaff()` — users where org type ATLAS
- [x] `inviteAtlasStaff` — mirror client invite, Atlas roles enum, temp password
- [x] `updateAtlasStaffRole`, `deactivateAtlasStaff` — guard self + last SYSTEM_ADMIN
- [x] i18n keys both locales both message roots
- [x] Verify: `tsc --noEmit`

### Task 2: Settings Staff UI

**Files:**
- Modify: `admin-settings-form.tsx` or new `admin-staff-panel.tsx`
- Modify: `admin/settings/page.tsx` — tabs Organisation | Staff

- [x] Staff list table + invite form
- [x] Toast temp password on invite
- [x] Role change + deactivate with confirm
- [x] Verify tsc

### Task 3: Catalogue create wizard (with required docs)

**Files:**
- Modify: `src/server/admin/queries.ts` — `listAdminCategoryTree`
- Modify: `src/server/admin/actions.ts` — `createServiceItem`
- Create: `src/components/atlas/admin/create-service-wizard.tsx`
- Modify: `admin-catalogue-table.tsx` / catalogue page — launch wizard
- i18n `adminOps.catalogue.create*`

- [x] Category tree query (main → subs)
- [x] Zod schema for service + docs array
- [x] Transaction create ServiceItem + RequiredDocuments
- [x] 3-step client wizard UI
- [x] Verify tsc

### Task 4: Coupon create form

**Files:**
- Modify: `src/server/admin/actions.ts` — `createCoupon`
- Create: `src/components/atlas/admin/create-coupon-form.tsx`
- Modify: coupons page/table
- i18n `adminOps.coupons.create*`

- [x] createCoupon action with full fields
- [x] Dialog/panel form
- [x] Verify tsc

### Task 5: Messaging actions + notify

**Files:**
- Modify: `src/server/requests/actions.ts` — `addClientRequestComment`
- Modify: `src/server/admin/actions.ts` — `addAtlasClientComment` (or requests)
- Wire `notify({ event: "COMMENT_ADDED", ... })`

- [x] Client action CLIENT_TO_ATLAS, org-scoped
- [x] Atlas action ATLAS_TO_CLIENT
- [x] Notify with link `/client/requests/{id}` or `/admin/requests/{id}` by recipient
- [x] Verify tsc

### Task 6: Messaging UI

**Files:**
- Modify: `client-request-detail.tsx` — composer
- Modify: `admin-request-detail.tsx` — client thread composer (keep internal separate)
- i18n keys

- [x] Client composer
- [x] Admin ATLAS_TO_CLIENT composer
- [x] Verify tsc + eslint on touched files

---

## Done when

All three features usable in UI; `tsc --noEmit` clean; no console.log/any.

**Status:** Complete (2026-07-24). Hardened: client comments revalidate admin detail; last-SYSTEM_ADMIN demotion blocked for any staff; staff table syncs on refresh.
