# Staff invites, create wizards & in-platform messaging

**Date:** 2026-07-24  
**Status:** Approved (user confirmed required documents in catalogue create flow)

## Goals

1. Atlas staff can invite/manage colleagues from Admin Settings.
2. Catalogue managers can create service items **with required documents** in one wizard; coupon managers can create coupons.
3. Client and Atlas can message each other on a request thread (non-INTERNAL); staff keep separate internal notes.

## Non-goals

- Email delivery of invite links (temp password toast, same as client invite).
- Editing existing service item / coupon full forms (create + existing toggle/pause).
- File attachments on comments (schema allows JSON; UI is text-only this pass).
- New Prisma models.

## 1. Atlas staff invites

**Surface:** `/admin/settings` — tabs: Organisation | Staff.

**Permission:** `SYSTEM_ADMIN` for invite, role change, deactivate. Other Atlas roles: read staff list only. Extend RBAC with `staff:manage` → SYSTEM_ADMIN (or reuse a dedicated check).

**Actions:**
- `inviteAtlasStaff({ email, fullNameEn, fullNameAr, role })` → ATLAS org, Atlas roles only, random temp password returned once.
- `updateAtlasStaffRole`, `deactivateAtlasStaff` (cannot self-deactivate / demote last SYSTEM_ADMIN).

**UI:** Mirror client company Users tab; show temp password in toast.

## 2. Catalogue create wizard (+ required docs)

**Surface:** `/admin/catalogue` — “Create service” opens wizard.

**Steps:**
1. Pick main → subcategory (from new `listAdminCategoryTree` query).
2. Service fields: code, nameEn/Ar, desc optional, basePrice, slaHours, vatRate, resubmissionPricePct, free/max resubmissions, sortOrder, active.
3. Required documents: dynamic list — code, nameEn/Ar, mandatory, acceptedMimeTypes, maxSizeMb, sortOrder. At least one recommended but allow zero.
4. Review → submit.

**Action:** `createServiceItem` in transaction: ServiceItem + nested RequiredDocument creates. Permission `catalogue:manage`. Audit log.

**Coupons:** `/admin/coupons` — “Create coupon” form/dialog. Action `createCoupon` with full Coupon fields (code, names, discount, dates, appliesTo, clientScope, limits). Permission `coupons:manage`.

## 3. In-platform messaging

**Actions:**
- `addClientRequestComment({ requestId, body })` → `CLIENT_TO_ATLAS`, `requests:create`/`read`, org-scoped.
- `addAtlasClientComment({ requestId, body })` → `ATLAS_TO_CLIENT`, `requests:admin`.
- Keep `addAdminInternalComment` for INTERNAL.

**Notify:** `COMMENT_ADDED` with `commentDirection` (recipients already defined).

**UI:** Composer under client-facing thread on both request detail panels. Internal notes stay separate on admin.

## i18n

All strings in `src/messages/{ar,en}.json`.

## Verification

- `tsc --noEmit`
- Manual: invite staff → toast password; create service with 2 docs; create coupon; client + admin exchange comments + notification.
