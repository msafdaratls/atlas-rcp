export const NOTIFICATION_EVENTS = [
  { type: "REQUEST_SUBMITTED", legalFinancial: false },
  { type: "REQUEST_RECEIVED", legalFinancial: false },
  { type: "REQUEST_RETURNED", legalFinancial: false },
  { type: "REQUEST_RESUBMITTED", legalFinancial: false },
  { type: "REQUEST_ACCEPTED", legalFinancial: false },
  { type: "REQUEST_ASSIGNED", legalFinancial: false },
  { type: "TECHNICAL_REVIEW_READY", legalFinancial: false },
  { type: "DECISION_READY", legalFinancial: false },
  { type: "REPORT_ISSUED", legalFinancial: false },
  { type: "CERTIFICATE_REFUSED", legalFinancial: false },
  { type: "REQUEST_CLOSED", legalFinancial: false },
  { type: "INVOICE_ISSUED", legalFinancial: true },
  { type: "PAYMENT_RECEIVED", legalFinancial: true },
  { type: "PAYMENT_REJECTED", legalFinancial: true },
  { type: "SLA_AT_RISK", legalFinancial: false },
  { type: "SLA_BREACHED", legalFinancial: false },
  { type: "COMMENT_ADDED", legalFinancial: false },
  { type: "NOTE_MENTION", legalFinancial: false },
  { type: "STATEMENT_OVERDUE", legalFinancial: true },
  { type: "CREDIT_LIMIT", legalFinancial: true },
  { type: "REOPEN_REQUESTED", legalFinancial: false },
  { type: "REOPEN_DECIDED", legalFinancial: false },
] as const;

export type NotificationEventType =
  (typeof NOTIFICATION_EVENTS)[number]["type"];

export function isNotificationEventType(
  value: string,
): value is NotificationEventType {
  return NOTIFICATION_EVENTS.some((e) => e.type === value);
}

export function isLegalFinancialEvent(type: string): boolean {
  return NOTIFICATION_EVENTS.some(
    (e) => e.type === type && e.legalFinancial,
  );
}

/**
 * In-app-only events: chat messages and mentions never leave the app,
 * regardless of the user's email notification preference.
 */
const IN_APP_ONLY_EVENTS: NotificationEventType[] = [
  "COMMENT_ADDED",
  "NOTE_MENTION",
];

export function isInAppOnlyEvent(type: string): boolean {
  return IN_APP_ONLY_EVENTS.includes(type as NotificationEventType);
}

/** Events shown on the company notification preferences grid. */
export const PREFERENCE_EVENTS = NOTIFICATION_EVENTS.filter((e) =>
  [
    "REQUEST_RECEIVED",
    "REQUEST_RETURNED",
    "REPORT_ISSUED",
    "CERTIFICATE_REFUSED",
    "REQUEST_CLOSED",
    "SLA_AT_RISK",
    "INVOICE_ISSUED",
    "PAYMENT_RECEIVED",
    "PAYMENT_REJECTED",
    "STATEMENT_OVERDUE",
    "CREDIT_LIMIT",
  ].includes(e.type),
);
