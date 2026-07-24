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
