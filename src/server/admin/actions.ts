/**
 * Barrel re-export — preserves the historical `@/server/admin/actions` import
 * path for the ~20 consumer files across the app while the implementation
 * lives in domain-scoped files. No "use server" here: each source file below
 * carries its own directive, and re-exporting an already-created Server
 * Action reference through a plain module is fine (only the file that
 * *defines* the action needs the directive).
 *
 * Split 2026-08-20 — this used to be one 5,200-line file mixing the request
 * state machine with catalogue/coupon/staff/lab reference-data CRUD, which
 * meant unrelated changes shared one file's blast radius and merge-conflict
 * surface. Add new actions to the domain file they belong to, not here.
 */
export * from "@/server/admin/workflow-actions";
export * from "@/server/admin/catalogue-actions";
export * from "@/server/admin/coupons-actions";
export * from "@/server/admin/staff-actions";
export * from "@/server/admin/laboratories-actions";
