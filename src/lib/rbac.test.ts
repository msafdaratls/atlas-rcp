import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SessionUser } from "@/lib/auth/session";
import {
  canTransitionRequest,
  requirePermission,
} from "@/lib/rbac";

function atlasSession(roles: SessionUser["roles"]): SessionUser {
  return {
    id: "user-1",
    email: "staff@atlas.test",
    organisationId: "org-atlas",
    fullNameEn: "Staff",
    fullNameAr: "موظف",
    locale: "ar",
    roles,
    organisation: {
      id: "org-atlas",
      nameEn: "Atlas",
      nameAr: "أطلس",
      logoKey: null,
      type: "ATLAS",
    },
  };
}

function clientSession(roles: SessionUser["roles"]): SessionUser {
  return {
    id: "user-client",
    email: "owner@client.test",
    organisationId: "org-client",
    fullNameEn: "Owner",
    fullNameAr: "مالك",
    locale: "ar",
    roles,
    organisation: {
      id: "org-client",
      nameEn: "Client Co",
      nameAr: "عميل",
      logoKey: null,
      type: "CLIENT",
    },
  };
}

describe("requirePermission Atlas role map", () => {
  it("denies catalogue:manage for FINANCE-only", () => {
    const session = atlasSession(["FINANCE"]);
    assert.throws(
      () => requirePermission(session, "catalogue:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("allows requests:admin for INTAKE_OFFICER", () => {
    const session = atlasSession(["INTAKE_OFFICER"]);
    assert.doesNotThrow(() =>
      requirePermission(session, "requests:admin"),
    );
  });

  it("allows clients:finance and analytics:finance for FINANCE + SYSTEM_ADMIN only", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["FINANCE"]), "clients:finance"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "analytics:finance"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["INTAKE_OFFICER"]), "clients:finance"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () =>
        requirePermission(atlasSession(["QUALITY_MANAGER"]), "analytics:finance"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("keeps admin:dashboard open to any Atlas staff", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["INTAKE_OFFICER"]), "admin:dashboard"),
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_OWNER"]), "admin:dashboard"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("requires isClient for preferences:write, requests:create, requests:read", () => {
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_OWNER"]), "preferences:write"),
    );
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_USER"]), "requests:create"),
    );
    assert.throws(
      () =>
        requirePermission(atlasSession(["SYSTEM_ADMIN"]), "preferences:write"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () => requirePermission(atlasSession(["SYSTEM_ADMIN"]), "requests:read"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("grants CLIENT_ADMIN the same access as CLIENT_OWNER for users:manage", () => {
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_ADMIN"]), "users:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_ADMIN"]), "company:write"),
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_USER"]), "users:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });
});

describe("requirePermission — remaining role-gated permissions", () => {
  // Each of these previously had zero test coverage (2026-08-19 audit) — a
  // future copy-paste mistake in any of these role lists, or an accidental
  // `||` in place of `&&`, would have shipped undetected.

  it("laboratories:manage — CATALOGUE_MANAGER and SYSTEM_ADMIN only", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["CATALOGUE_MANAGER"]), "laboratories:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "laboratories:manage"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["FINANCE"]), "laboratories:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("coupons:manage — CATALOGUE_MANAGER, FINANCE, and SYSTEM_ADMIN", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["CATALOGUE_MANAGER"]), "coupons:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["FINANCE"]), "coupons:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "coupons:manage"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["INTAKE_OFFICER"]), "coupons:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("quality:read — QUALITY_MANAGER, SYSTEM_ADMIN, and DECISION_MAKER", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["QUALITY_MANAGER"]), "quality:read"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "quality:read"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["DECISION_MAKER"]), "quality:read"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["FINANCE"]), "quality:read"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("audit:read — SYSTEM_ADMIN and QUALITY_MANAGER only, NOT DECISION_MAKER", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "audit:read"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["QUALITY_MANAGER"]), "audit:read"),
    );
    // DECISION_MAKER holds quality:read but must NOT also get audit:read —
    // the two role lists are similar but deliberately not identical.
    assert.throws(
      () => requirePermission(atlasSession(["DECISION_MAKER"]), "audit:read"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("settings:admin and staff:manage — SYSTEM_ADMIN only, not even QUALITY_MANAGER", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "settings:admin"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "staff:manage"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["QUALITY_MANAGER"]), "settings:admin"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () => requirePermission(atlasSession(["QUALITY_MANAGER"]), "staff:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("system:health — SYSTEM_ADMIN only, not even QUALITY_MANAGER", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "system:health"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["QUALITY_MANAGER"]), "system:health"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_OWNER"]), "system:health"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("credentials:manage — client CLIENT_OWNER/CLIENT_ADMIN manage their own org's credentials, CLIENT_USER cannot", () => {
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_OWNER"]), "credentials:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_ADMIN"]), "credentials:manage"),
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_USER"]), "credentials:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("credentials:manage — Atlas staff need on-behalf authority (same roles as requests:create-behalf)", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["INTAKE_OFFICER"]), "credentials:manage"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["EVALUATOR"]), "credentials:manage"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("credentials:reveal — any requests:admin role, never a client", () => {
    for (const role of [
      "INTAKE_OFFICER",
      "EVALUATOR",
      "TECHNICAL_REVIEWER",
      "DECISION_MAKER",
      "SYSTEM_ADMIN",
      "QUALITY_MANAGER",
    ] as const) {
      assert.doesNotThrow(
        () => requirePermission(atlasSession([role]), "credentials:reveal"),
        `expected ${role} to be granted credentials:reveal`,
      );
    }
    assert.throws(
      () => requirePermission(atlasSession(["FINANCE"]), "credentials:reveal"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_OWNER"]), "credentials:reveal"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("clients:read — INTAKE_OFFICER, DECISION_MAKER, FINANCE, SYSTEM_ADMIN, QUALITY_MANAGER, NOT EVALUATOR", () => {
    for (const role of [
      "INTAKE_OFFICER",
      "DECISION_MAKER",
      "FINANCE",
      "SYSTEM_ADMIN",
      "QUALITY_MANAGER",
    ] as const) {
      assert.doesNotThrow(
        () => requirePermission(atlasSession([role]), "clients:read"),
        `expected ${role} to be granted clients:read`,
      );
    }
    // EVALUATOR works requests day-to-day (requests:admin) but is
    // deliberately not on the client-roster read list.
    assert.throws(
      () => requirePermission(atlasSession(["EVALUATOR"]), "clients:read"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("clients:create and requests:create-behalf — INTAKE_OFFICER and SYSTEM_ADMIN only", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["INTAKE_OFFICER"]), "clients:create"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "requests:create-behalf"),
    );
    assert.throws(
      () => requirePermission(atlasSession(["DECISION_MAKER"]), "clients:create"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () =>
        requirePermission(atlasSession(["DECISION_MAKER"]), "requests:create-behalf"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("finance:client — client CLIENT_OWNER/CLIENT_ADMIN/CLIENT_FINANCE only, never Atlas staff", () => {
    assert.doesNotThrow(() =>
      requirePermission(clientSession(["CLIENT_FINANCE"]), "finance:client"),
    );
    assert.throws(
      () => requirePermission(clientSession(["CLIENT_USER"]), "finance:client"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
    assert.throws(
      () => requirePermission(atlasSession(["FINANCE"]), "finance:client"),
      (err: unknown) => err instanceof Error && err.message === "FORBIDDEN",
    );
  });

  it("catalogue:manage — positive allow for CATALOGUE_MANAGER and SYSTEM_ADMIN", () => {
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["CATALOGUE_MANAGER"]), "catalogue:manage"),
    );
    assert.doesNotThrow(() =>
      requirePermission(atlasSession(["SYSTEM_ADMIN"]), "catalogue:manage"),
    );
  });
});

describe("canTransitionRequest fail closed", () => {
  it("returns false for FINANCE-only transitioning to REPORT_ISSUED", () => {
    const session = atlasSession(["FINANCE"]);
    assert.equal(canTransitionRequest(session, "REPORT_ISSUED"), false);
  });

  it("returns true for DECISION_MAKER to REPORT_ISSUED", () => {
    const session = atlasSession(["DECISION_MAKER"]);
    assert.equal(canTransitionRequest(session, "REPORT_ISSUED"), true);
  });

  it("returns true for SYSTEM_ADMIN to any specialist state", () => {
    const session = atlasSession(["SYSTEM_ADMIN"]);
    assert.equal(canTransitionRequest(session, "REPORT_ISSUED"), true);
    assert.equal(canTransitionRequest(session, "UNDER_INTAKE_REVIEW"), true);
    assert.equal(canTransitionRequest(session, "TECHNICAL_REVIEW"), true);
  });

  it("allows INTAKE_OFFICER to resume ON_HOLD back to SUBMITTED", () => {
    const session = atlasSession(["INTAKE_OFFICER"]);
    assert.equal(
      canTransitionRequest(session, "SUBMITTED", {
        fromState: "ON_HOLD",
        heldFromState: "SUBMITTED",
      }),
      true,
    );
  });

  it("allows TECHNICAL_REVIEWER to resume ON_HOLD back to ACCEPTED", () => {
    const session = atlasSession(["TECHNICAL_REVIEWER"]);
    assert.equal(
      canTransitionRequest(session, "ACCEPTED", {
        fromState: "ON_HOLD",
        heldFromState: "ACCEPTED",
      }),
      true,
    );
  });

  it("still denies FINANCE resuming ON_HOLD to SUBMITTED", () => {
    const session = atlasSession(["FINANCE"]);
    assert.equal(
      canTransitionRequest(session, "SUBMITTED", {
        fromState: "ON_HOLD",
        heldFromState: "SUBMITTED",
      }),
      false,
    );
  });

  it("denies INTAKE_OFFICER setting SUBMITTED outside hold resume", () => {
    const session = atlasSession(["INTAKE_OFFICER"]);
    assert.equal(canTransitionRequest(session, "SUBMITTED"), false);
  });
});
