import type { Role } from "@prisma/client";

/**
 * Written manual for the admin console, fed into the admin assistant's
 * system prompt as grounding text (mirrors catalogue-context.ts's role for
 * the client chat) — the AI fallback is instructed to answer only from
 * this, never invent a workflow step. English-only by design: this text is
 * never shown to the user directly (canned-answers.ts holds the bilingual
 * strings that are), it's only read by the model, which is told to reply in
 * whatever language the staff member wrote in.
 *
 * Kept as static text, not DB-backed: unlike the catalogue (admin-edited,
 * changes often), the console's page layout and workflow only change with a
 * code deploy, so there's no staleness risk worth a live query for.
 */
type ManualSection = {
  id: string;
  title: string;
  /** Omitted = shown to every Atlas staff role. */
  roles?: Role[];
  body: string;
};

const SECTIONS: ManualSection[] = [
  {
    id: "lifecycle",
    title: "Request lifecycle (state machine)",
    body: `Every request moves through these states in order: SUBMITTED -> UNDER_INTAKE_REVIEW -> ACCEPTED -> ASSESSMENT_QUEUED -> ASSESSMENT_RUNNING -> TECHNICAL_REVIEW -> DECISION -> REPORT_ISSUED -> CLOSED.
- RETURNED_TO_CLIENT, ON_HOLD, and CANCELLED are reachable from most active states.
- A request made up entirely of SCOC-type items skips Technical Review: the Evaluator's "Complete Evaluation" action goes straight from ASSESSMENT_RUNNING to DECISION.
- A request made up entirely of Lab Testing Coordination (service code LAB-001) items skips both Technical Review and Decision: the Evaluator's one-click "Complete Testing" action cascades straight from ASSESSMENT_RUNNING to REPORT_ISSUED to CLOSED.
- DECISION -> CLOSED (via "Refuse Certification") is the refusal path, bypassing REPORT_ISSUED.
- REPORT_ISSUED -> CLOSED (via "Complete Certificate Issuance") is the Evaluator's step after attaching the real external certificate.
- Each role owns the transitions for its own stage: INTAKE_OFFICER owns intake-stage moves, EVALUATOR owns assessment-stage moves plus the certificate-close step, TECHNICAL_REVIEWER owns technical-review-stage moves, DECISION_MAKER owns decision-stage moves. Any of these four roles may place or resume a Hold. FINANCE, CATALOGUE_MANAGER, and QUALITY_MANAGER cannot transition a request at all — they can only view/report on it. SYSTEM_ADMIN can act on any request from any state.
- A Conflict-of-Interest acknowledgement checkbox is required before: Complete Evaluation, Complete Testing, Complete Technical Review, and Refuse Certification.`,
  },
  {
    id: "dashboard",
    title: "Dashboard and Analytics",
    body: `The Dashboard (home page) and the separate Analytics page show the same underlying data: queue-depth tiles per stage with an SLA-at-risk count, a 30-day received-vs-closed chart, and top return reasons over the last 90 days. Both are visible to every Atlas staff role. Revenue and clients-over-credit-limit widgets only appear for FINANCE and SYSTEM_ADMIN. Neither page has any action buttons — they are read-only, and queue tiles link into the filtered Requests list.`,
  },
  {
    id: "queues",
    title: "Work Queues",
    body: `The Work Queues page (/admin/queues) shows six count tiles: Intake, Assessment, Technical review, Decision, Returned, On hold. Clicking a tile navigates to the Requests list pre-filtered to that group of states. Visible to INTAKE_OFFICER, EVALUATOR, TECHNICAL_REVIEWER, DECISION_MAKER, QUALITY_MANAGER, SYSTEM_ADMIN. There is no "claim" button on this page — a staff member opens a request from the filtered list and either clicks the stage's own action (which auto-assigns them if the request is unassigned) or uses the explicit Assign control on the request detail page.`,
  },
  {
    id: "requests-list",
    title: "Requests list",
    body: `The Requests page (/admin/requests) is a searchable, filterable table of every request (state, client, SLA due date, unread-client-message flag). Visible to the same roles as Work Queues. A "New Request" button (to start a request on behalf of a client) only appears for INTAKE_OFFICER and SYSTEM_ADMIN. Opening a row goes to the request detail page, where all real work happens.`,
  },
  {
    id: "request-detail-assign",
    title: "Assigning a request",
    roles: ["INTAKE_OFFICER", "EVALUATOR", "TECHNICAL_REVIEWER", "DECISION_MAKER", "QUALITY_MANAGER", "SYSTEM_ADMIN"],
    body: `On a request's detail page, any staff member with access to Requests can use the "Assign" control to hand a request to a specific colleague. The picker defaults to filtering by the role that normally owns the request's current stage (Intake Officer for SUBMITTED/UNDER_INTAKE_REVIEW, Evaluator for ASSESSMENT_QUEUED/ASSESSMENT_RUNNING/REPORT_ISSUED, Technical Reviewer for TECHNICAL_REVIEW, Decision Maker for DECISION), but falls back to the full staff list if nobody with that role exists. Several of the main lifecycle buttons (e.g. Intake Officer's "Complete Application Review") also auto-assign the clicking user if the request is currently unassigned, so opening and acting on an unassigned request from your queue is itself a valid way to "pick it up".`,
  },
  {
    id: "intake-review",
    title: "Intake review and Complete Application Review",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    body: `An Intake Officer moves a new SUBMITTED request to UNDER_INTAKE_REVIEW to start reviewing it, then either returns it to the client (see below) or clicks "Complete Application Review" once it's in order. That one click cascades the request through ACCEPTED -> ASSESSMENT_QUEUED -> ASSESSMENT_RUNNING in a single transaction, and automatically assigns the request to that service's configured default Evaluator (set on the service in the Catalogue). The client is notified their request was accepted at this point. When the request contains items the Label Evaluator covers, clicking the button first asks how the request should be assessed — "AI assessment" (the Label Evaluator reads the artwork and proposes a verdict per checklist item) or "Manual assessment" (the Evaluator judges every item themselves on the manual evaluation page). The choice is recorded per item and only decides where the work starts: the Evaluator can change it from the "Assessment method" panel on the request page while the request is in ASSESSMENT_RUNNING, and both routes stay reachable either way.`,
  },
  {
    id: "return-to-client",
    title: "Return to Client",
    roles: ["INTAKE_OFFICER", "EVALUATOR", "TECHNICAL_REVIEWER", "DECISION_MAKER", "SYSTEM_ADMIN"],
    body: `Any of the four process roles (or System Admin) can return a request to the client from most active states via "Return to Client" on the request detail page. The dialog requires picking at least one return reason code and a fault attribution (Client / Atlas / Regulatory) plus a note — the request moves to RETURNED_TO_CLIENT and the client is notified to fix and resubmit.`,
  },
  {
    id: "create-client-onbehalf",
    title: "Creating a client and submitting on their behalf",
    roles: ["INTAKE_OFFICER", "SYSTEM_ADMIN"],
    body: `Intake Officer and System Admin can create a new client organisation from the Clients page ("Create Client" — company name in English and Arabic, owner email/phone/password; the account is created active and pre-verified). The same two roles can also start a new request on behalf of an existing client via "New Request" on the Requests list, the Clients detail page, or an Engagement's detail page — this pins the acting client organisation and then walks the same multi-step wizard a client uses themselves (service pick, product details, document upload, submit). The request enters the normal lifecycle at SUBMITTED, landing in the Intake queue.`,
  },
  {
    id: "assessment-panel",
    title: "Assessment panel",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `On a request in ASSESSMENT_RUNNING (through DECISION/REPORT_ISSUED for late edits), the Evaluator works the Assessment panel — a per-service-item compliance checklist where each check item is marked Compliant / Non-Compliant / N-A. This checklist is the same one the Label Evaluator AI tool's "Promote to Official Checklist" action writes into, when used.`,
  },
  {
    id: "evaluation-activities",
    title: "Evaluation activities: inspection, lab testing, factory audit",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `For services requiring inspection, lab testing, or a factory audit, the Evaluation Activities panel on the request detail page tracks it. For inspection/factory audit: schedule a date and inspector/auditor qualification, then mark it complete once done. For lab testing specifically, the sequence is: add the required tests (from the Test Types catalogue, or a free-text custom label) -> select a laboratory (from the accredited-labs list) -> record the sample shipment (tracking number, carrier, sent date) -> confirm the sample was received at the lab -> upload the lab's report file(s) -> mark the activity Complete (this last step hard-requires at least one uploaded report). For a request made up entirely of Lab Testing Coordination (LAB-001) items, once every item's lab-testing activity is Complete, the Evaluator's dedicated "Complete Testing" button appears — one click cascades straight to REPORT_ISSUED and then CLOSED, skipping Technical Review and Decision entirely.`,
  },
  {
    id: "evaluation-report",
    title: "Evaluation Report upload",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `Before the Evaluator can advance a request out of ASSESSMENT_RUNNING (via "Complete Evaluation"), an Evaluation Report document must be uploaded per required item — the Evaluation Report panel on the request detail page is where that happens. Trying to advance without it is blocked with an explicit error naming which item is missing its report.`,
  },
  {
    id: "complete-evaluation",
    title: "Complete Evaluation (advancing out of Assessment)",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `Once the Assessment panel, any evaluation activities, and the Evaluation Report are all in order, the Evaluator clicks "Complete Evaluation" (after confirming the Conflict-of-Interest checkbox). For a normal request this moves it to TECHNICAL_REVIEW. For a request made up entirely of SCOC-type items, the same button skips Technical Review and moves it straight to DECISION instead.`,
  },
  {
    id: "label-evaluator-ai",
    title: "Label Evaluator (AI-assisted label checking)",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `The Label Evaluator (SFDA Supplements and Cosmetics, two separate pages under /admin/label-evaluator) is an AI-assisted tool that sits inside the Evaluator's normal assessment step, not a separate pipeline. It lists request items awaiting evaluation, each row offering both routes: "AI evaluation" kicks off extraction of structured label fields from the uploaded artwork, while "Manual evaluation" opens a hand-worked run at /admin/label-evaluator/manual/<id> — the same KB checklist with nothing pre-filled, where the evaluator sets every verdict themselves (and, for cosmetics, states the product category), then clicks "Complete manual assessment". A completed manual run becomes an ordinary assessed one and uses the identical "Promote to Official Checklist" action described below; no extraction, classifier or model ever runs against it. Only one run can be in flight per item, whichever route it came from. The rest of this section describes the AI route. In the assessment workspace, the reviewer confirms or edits each extracted field, can reclassify the product category if the AI's match looks wrong, then "Confirm & Run Assessment" runs a rule engine that proposes a COMPLIANT/NON_COMPLIANT/NEEDS_REVIEW verdict per rule — the reviewer either Confirms each proposal or Overrides it with their own verdict. The AI never decides on its own: nothing counts as official until a human confirms or overrides it. Finally, "Promote to Official Checklist" writes the confirmed verdicts into the request's real Assessment panel checklist (NEEDS_REVIEW/REQUIRES_ADDITIONAL_DATA verdicts are never force-converted to a pass/fail). Managing the underlying knowledge-base datasets ("Manage Datasets") is restricted to CATALOGUE_MANAGER and SYSTEM_ADMIN.`,
  },
  {
    id: "external-deliverable",
    title: "External Deliverable panel (SCOC / SABER / SFDA certificates)",
    roles: ["EVALUATOR", "SYSTEM_ADMIN"],
    body: `For items whose deliverable is an externally-issued certificate (SCOC, SABER, SFDA-cosmetics types), the External Deliverable panel appears from DECISION onward: submit the external application, then once the real certificate comes back, upload/attach it and mark it Issued (or Reject it and note why). Attaching the real certificate is what unlocks the Evaluator's "Complete Certificate Issuance" button, which is the only way a REPORT_ISSUED request reaches CLOSED.`,
  },
  {
    id: "technical-review",
    title: "Technical Review checklist",
    roles: ["TECHNICAL_REVIEWER", "SYSTEM_ADMIN"],
    body: `While a request is in TECHNICAL_REVIEW, the Technical Reviewer fills in the Technical Review Checklist panel — a single request-level meta-checklist (was the evaluation report reviewed, were standards verified, etc.) sourced from one global definition editable only by System Admin in Settings. Every item on it must have a verdict before "Advance to Decision" (after confirming the Conflict-of-Interest checkbox) is allowed.`,
  },
  {
    id: "decision",
    title: "Grant or Refuse Certification",
    roles: ["DECISION_MAKER", "SYSTEM_ADMIN"],
    body: `On a request in DECISION, the Decision Maker either clicks "Grant Certification" (moves to REPORT_ISSUED, clears the assignee so it lands in an unassigned Evaluator's queue to finish issuing the certificate) or "Refuse Certification" (requires a mandatory refusal note, moves straight to CLOSED — this is the only way a DECISION request reaches CLOSED without going through REPORT_ISSUED). Both require confirming the Conflict-of-Interest checkbox first.`,
  },
  {
    id: "quality-decision-access",
    title: "Quality page",
    roles: ["QUALITY_MANAGER", "DECISION_MAKER", "SYSTEM_ADMIN"],
    body: `The Quality page (/admin/quality) is a read-only dashboard of return-reason counts and a recent audit-log feed, for QUALITY_MANAGER, DECISION_MAKER, and SYSTEM_ADMIN. There are no actions on this page — findings are acted on by messaging the relevant staff member from the affected request's comment thread.`,
  },
  {
    id: "audit-log",
    title: "Audit log",
    roles: ["QUALITY_MANAGER", "SYSTEM_ADMIN"],
    body: `The Audit page (/admin/audit) is a system-wide, read-only browser of every audit-log entry (actor, action, entity, before/after values), filterable by action and entity type. Restricted to QUALITY_MANAGER and SYSTEM_ADMIN — broader in scope than the Quality page's return-reason summary.`,
  },
  {
    id: "documents",
    title: "Documents",
    body: `The Documents page (/admin/documents) is a read-only, system-wide search across every uploaded file on every request (labels, certificates, activity/evaluation reports), searchable and filterable by file type. Visible to the same roles as Requests/Work Queues. It's a lookup tool only — clicking a request number jumps to that request's detail page.`,
  },
  {
    id: "engagements",
    title: "Engagements",
    body: `Engagements (/admin/engagements) track an ongoing retainer-style relationship for a client (for example an Account Management service) that spawns many individual requests over time. "Create Engagement" picks the client and the relevant service; a "New Request" button on an engagement's detail page pins that client and starts a new on-behalf request pre-linked to the engagement. "Close" ends the engagement. Visible to the same roles as Requests/Work Queues.`,
  },
  {
    id: "clients",
    title: "Clients directory",
    roles: ["INTAKE_OFFICER", "DECISION_MAKER", "FINANCE", "QUALITY_MANAGER", "SYSTEM_ADMIN"],
    body: `The Clients page lists every client organisation with a read-only profile per client (org info, request history, finance balance snippet, owner and user list). Visible to INTAKE_OFFICER, DECISION_MAKER, FINANCE, QUALITY_MANAGER, SYSTEM_ADMIN — note EVALUATOR and TECHNICAL_REVIEWER do not have access to this page. Only INTAKE_OFFICER and SYSTEM_ADMIN see the "Create Client" button.`,
  },
  {
    id: "catalogue",
    title: "Service Catalogue management",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    body: `The Catalogue page (/admin/catalogue), restricted to CATALOGUE_MANAGER and SYSTEM_ADMIN, manages the Main Category -> Sub Category -> Service Item structure everything else is built from. "Manage Categories" creates/renames/deletes categories (blocked while children exist). "Create Service" is a 5-step wizard: (1) pick category, (2) basics — code, SLA hours, bilingual name/description, base price, VAT rate, resubmission pricing, active flag, which evaluation activities apply, (3) product attributes and the compliance check sets that become the Evaluator's Assessment panel checklist, (4) required-document slots (code, max size, accepted file types, mandatory flag), (5) review and confirm. The table also lets you toggle a service active/inactive, edit it, upload a blank-form template per document slot, and set the service's default Evaluator (used by Intake Officer's "Complete Application Review" auto-assignment).`,
  },
  {
    id: "laboratories",
    title: "Laboratories and Test Types",
    roles: ["CATALOGUE_MANAGER", "SYSTEM_ADMIN"],
    body: `The Laboratories page (/admin/laboratories), restricted to CATALOGUE_MANAGER and SYSTEM_ADMIN, manages two reference tables: accredited Laboratories (create/edit/toggle-active/delete, code must be globally unique, delete blocked while referenced by any request activity) and Test Types (same CRUD pattern, delete blocked while referenced by a required-tests checklist row). This is the reference data the Evaluator picks from in the Evaluation Activities panel when scheduling lab testing.`,
  },
  {
    id: "coupons",
    title: "Coupons",
    roles: ["CATALOGUE_MANAGER", "FINANCE", "SYSTEM_ADMIN"],
    body: `The Coupons page manages discount codes clients can apply in the request wizard, restricted to CATALOGUE_MANAGER, FINANCE, and SYSTEM_ADMIN (Finance is included since coupons affect revenue). "Create Coupon" sets the code, bilingual name, discount type (percent or fixed), what it applies to (all services / a main category / a sub category / one service item), which clients can use it (all / specific / new-clients-only), and a validity window. The table lets you activate, deactivate, or expire an existing coupon.`,
  },
  {
    id: "finance",
    title: "Finance",
    roles: ["FINANCE", "SYSTEM_ADMIN"],
    body: `The Finance page (/admin/finance), restricted to FINANCE and SYSTEM_ADMIN, has three tabs. Queue: pending payments clients submitted proof for — Confirm posts it to the ledger, Reject requires a reason (min 3 characters); a "View Proof" link opens the uploaded payment proof. Balances: every client's balance and days-overdue, with an inline credit-limit editor (amount plus an "auto-hold when over limit" checkbox) — turning that on means the client's future requests get held for non-payment once they exceed the limit. Adjust: a manual ledger entry form (pick client, entry type — Adjustment / Credit Note / Refund / Write-off, debit or credit, amount, optionally settle against a specific open invoice for Credit Note/Write-off types).`,
  },
  {
    id: "settings",
    title: "Settings",
    roles: ["SYSTEM_ADMIN"],
    body: `The Settings page (/admin/settings), restricted to SYSTEM_ADMIN only, has three tabs. Organisation: edit Atlas's own org profile. Staff: invite a new Atlas staff member (sets their initial role(s), sends an invite email), change an existing staff member's role(s), or deactivate a staff account — role changes take effect on that person's next page load, since roles drive both the sidebar and every permission check. Technical Review Checklist: edit the single global checklist definition that every request's Technical Reviewer fills in at the Technical Review stage; changes apply immediately to every request currently in that stage.`,
  },
  {
    id: "system-health",
    title: "System Health",
    roles: ["SYSTEM_ADMIN"],
    body: `The System Health page (/admin/system-health), restricted to SYSTEM_ADMIN only, is a read-only operator diagnostics view: background jobs that dead-lettered after exhausting retries (failed notification-outbox deliveries and failed label-extraction jobs), plus a pending-outbox count. There is no retry button in the UI — this page is for spotting things like a stuck email provider or an expired API credential; fixing the underlying cause happens outside the app.`,
  },
  {
    id: "notifications",
    title: "Notifications",
    body: `The Notifications page is a personal inbox of the logged-in staff member's own alerts (assignments, state changes, etc.) — available to every role, scoped to your own account. Clicking a notification deep-links to the relevant request.`,
  },
];

/** Renders the sections visible to at least one of the given roles, in a fixed order. */
export function buildAdminManualContext(roles: Role[]): string {
  const visible = SECTIONS.filter((s) => !s.roles || s.roles.some((r) => roles.includes(r)));
  return visible.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
}
