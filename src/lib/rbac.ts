import type { Role, RequestState } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";

export function hasRole(session: SessionUser, role: Role): boolean {
  return session.roles.includes(role);
}

export function hasAnyRole(session: SessionUser, roles: Role[]): boolean {
  return roles.some((role) => session.roles.includes(role));
}

const REQUESTS_ADMIN_ROLES: Role[] = [
  "INTAKE_OFFICER",
  "EVALUATOR",
  "TECHNICAL_REVIEWER",
  "DECISION_MAKER",
  "SYSTEM_ADMIN",
  "QUALITY_MANAGER",
];

const CLIENTS_READ_ROLES: Role[] = [
  "INTAKE_OFFICER",
  "DECISION_MAKER",
  "FINANCE",
  "SYSTEM_ADMIN",
  "QUALITY_MANAGER",
];

/** Staff who may create client accounts and open requests on their behalf. */
const CLIENTS_CREATE_ROLES: Role[] = ["INTAKE_OFFICER", "SYSTEM_ADMIN"];

const CATALOGUE_MANAGE_ROLES: Role[] = ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"];

const COUPONS_MANAGE_ROLES: Role[] = [
  "CATALOGUE_MANAGER",
  "FINANCE",
  "SYSTEM_ADMIN",
];

const QUALITY_READ_ROLES: Role[] = [
  "QUALITY_MANAGER",
  "SYSTEM_ADMIN",
  "DECISION_MAKER",
];

const FINANCE_ADMIN_ROLES: Role[] = ["FINANCE", "SYSTEM_ADMIN"];

const AUDIT_READ_ROLES: Role[] = ["SYSTEM_ADMIN", "QUALITY_MANAGER"];

export function requirePermission(
  session: SessionUser,
  permission:
    | "company:read"
    | "company:write"
    | "users:manage"
    | "preferences:write"
    | "requests:create"
    | "requests:read"
    | "requests:admin"
    | "finance:client"
    | "finance:admin"
    | "admin:dashboard"
    | "clients:read"
    | "clients:create"
    | "requests:create-behalf"
    | "clients:finance"
    | "analytics:finance"
    | "catalogue:manage"
    | "coupons:manage"
    | "quality:read"
    | "audit:read"
    | "settings:admin"
    | "staff:manage"
    | "credentials:manage"
    | "credentials:reveal",
): void {
  const isClient = session.organisation.type === "CLIENT";
  const isAtlas = session.organisation.type === "ATLAS";

  if (!isClient && permission.startsWith("company")) {
    throw new Error("FORBIDDEN");
  }

  switch (permission) {
    case "company:read":
      return;
    case "company:write":
    case "users:manage":
      if (!hasAnyRole(session, ["CLIENT_OWNER", "CLIENT_ADMIN"])) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "preferences:write":
      if (
        !isClient ||
        !hasAnyRole(session, [
          "CLIENT_OWNER",
          "CLIENT_ADMIN",
          "CLIENT_USER",
          "CLIENT_FINANCE",
        ])
      ) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "requests:create":
    case "requests:read":
      if (
        !isClient ||
        !hasAnyRole(session, ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_USER"])
      ) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "finance:client":
      if (
        !isClient ||
        !hasAnyRole(session, ["CLIENT_OWNER", "CLIENT_ADMIN", "CLIENT_FINANCE"])
      ) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "finance:admin":
      if (!isAtlas || !hasAnyRole(session, FINANCE_ADMIN_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "admin:dashboard":
      // Overview only — any Atlas staff may see the admin dashboard.
      if (!isAtlas) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "clients:finance":
    case "analytics:finance":
      // Client balances / revenue — FINANCE + SYSTEM_ADMIN only.
      if (!isAtlas || !hasAnyRole(session, FINANCE_ADMIN_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;

    case "requests:admin":
      if (!isAtlas || !hasAnyRole(session, REQUESTS_ADMIN_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "clients:read":
      if (!isAtlas || !hasAnyRole(session, CLIENTS_READ_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "clients:create":
    case "requests:create-behalf":
      if (!isAtlas || !hasAnyRole(session, CLIENTS_CREATE_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "catalogue:manage":
      if (!isAtlas || !hasAnyRole(session, CATALOGUE_MANAGE_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "coupons:manage":
      if (!isAtlas || !hasAnyRole(session, COUPONS_MANAGE_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "quality:read":
      if (!isAtlas || !hasAnyRole(session, QUALITY_READ_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "audit:read":
      if (!isAtlas || !hasAnyRole(session, AUDIT_READ_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "settings:admin":
    case "staff:manage":
      if (!isAtlas || !hasRole(session, "SYSTEM_ADMIN")) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "credentials:manage":
      // Client org owners/admins manage their org's stored portal logins.
      if (!isClient || !hasAnyRole(session, ["CLIENT_OWNER", "CLIENT_ADMIN"])) {
        throw new Error("FORBIDDEN");
      }
      return;
    case "credentials:reveal":
      // Staff working a request need the plaintext to actually log into the
      // client's GHAD/SABER/FASAH account — gated to the same roles that
      // work requests day-to-day, and every reveal is audit-logged.
      if (!isAtlas || !hasAnyRole(session, REQUESTS_ADMIN_ROLES)) {
        throw new Error("FORBIDDEN");
      }
      return;
    default: {
      const _exhaustive: never = permission;
      throw new Error(`Unknown permission: ${_exhaustive}`);
    }
  }
}

/** Non-throwing permission check for UI gating. */
export function checkPermission(
  session: SessionUser,
  permission: Parameters<typeof requirePermission>[1],
): boolean {
  try {
    requirePermission(session, permission);
    return true;
  } catch {
    return false;
  }
}

/** Prisma queries that touch tenant data must go through this. */
export function scopedOrganisationId(session: SessionUser): string {
  return session.organisationId;
}

const INTAKE_OFFICER_TRANSITIONS: RequestState[] = [
  "UNDER_INTAKE_REVIEW",
  "RETURNED_TO_CLIENT",
  "ON_HOLD",
  "CANCELLED",
  "ACCEPTED",
];

/**
 * Evaluation-stage duties, split off TECHNICAL_REVIEWER so the same person
 * cannot both evaluate a request and technically review their own
 * evaluation. Also covers the certificate hand-off: once a Decision Maker
 * grants, the Evaluator uploads the real external certificate and performs
 * the final close. CLOSED is deliberately excluded here — REPORT_ISSUED ->
 * CLOSED is granted via the CLOSED_FROM special case below, since CLOSED is
 * also the target of the unrelated DECISION -> CLOSED refusal path, which
 * stays a Decision Maker action.
 */
const EVALUATOR_TRANSITIONS: RequestState[] = [
  "ASSESSMENT_QUEUED",
  "ASSESSMENT_RUNNING",
  // The Evaluator clicks "Complete Evaluation" to hand the request to the
  // Technical Reviewer — this is the Evaluator's own outgoing transition,
  // not something only an admin should be able to trigger.
  "TECHNICAL_REVIEW",
  "REPORT_ISSUED",
  "ON_HOLD",
  "RETURNED_TO_CLIENT",
  "CANCELLED",
];

const TECHNICAL_REVIEWER_TRANSITIONS: RequestState[] = [
  "TECHNICAL_REVIEW",
  // The reviewer clicks "Complete Technical Review" to hand the request to
  // the Decision Maker — same reasoning as EVALUATOR_TRANSITIONS above.
  "DECISION",
  "ON_HOLD",
  "RETURNED_TO_CLIENT",
  "CANCELLED",
];

const DECISION_MAKER_TRANSITIONS: RequestState[] = [
  "DECISION",
  "REPORT_ISSUED",
  "RETURNED_TO_CLIENT",
  "ON_HOLD",
  "CANCELLED",
];

const SPECIALIST_TRANSITIONS: Array<[Role, RequestState[]]> = [
  ["INTAKE_OFFICER", INTAKE_OFFICER_TRANSITIONS],
  ["EVALUATOR", EVALUATOR_TRANSITIONS],
  ["TECHNICAL_REVIEWER", TECHNICAL_REVIEWER_TRANSITIONS],
  ["DECISION_MAKER", DECISION_MAKER_TRANSITIONS],
];

export type TransitionContext = {
  /** Current request state before the transition. */
  fromState?: RequestState;
  /** Prior state when currently ON_HOLD (for resume checks). */
  heldFromState?: RequestState | null;
};

/**
 * Only SYSTEM_ADMIN or matching specialist roles may transition a request.
 * Finance / Catalogue / Quality-only staff are denied (fail closed).
 * If a user holds several specialist roles, allowed target states are the
 * union (OR) of each role's set.
 *
 * Special case: any specialist may resume ON_HOLD back to `heldFromState`
 * (including SUBMITTED / ACCEPTED), even when that state is not otherwise
 * in their forward allow-list — otherwise holds become stuck.
 *
 * Special case: CLOSED is the target of two unrelated edges that need
 * different actors — DECISION -> CLOSED is the Decision Maker's refusal
 * path, REPORT_ISSUED -> CLOSED is the Evaluator completing certificate
 * issuance — so it's resolved by fromState rather than a flat allow-list.
 */
export function canTransitionRequest(
  session: SessionUser,
  toState: RequestState,
  ctx: TransitionContext = {},
): boolean {
  if (session.organisation.type !== "ATLAS") {
    return false;
  }
  if (hasRole(session, "SYSTEM_ADMIN")) {
    return true;
  }

  const matchingRoles = SPECIALIST_TRANSITIONS.filter(([role]) =>
    hasRole(session, role),
  );
  if (matchingRoles.length === 0) {
    return false;
  }

  if (toState === "CLOSED") {
    if (ctx.fromState === "DECISION") {
      return matchingRoles.some(([role]) => role === "DECISION_MAKER");
    }
    if (ctx.fromState === "REPORT_ISSUED") {
      return matchingRoles.some(([role]) => role === "EVALUATOR");
    }
  }

  // Resume from hold: any specialist who can place holds may restore prior state.
  if (
    ctx.fromState === "ON_HOLD" &&
    toState !== "CANCELLED" &&
    toState === (ctx.heldFromState ?? "UNDER_INTAKE_REVIEW")
  ) {
    return matchingRoles.some(([, allowed]) => allowed.includes("ON_HOLD"));
  }

  return matchingRoles.some(([, allowed]) => allowed.includes(toState));
}
