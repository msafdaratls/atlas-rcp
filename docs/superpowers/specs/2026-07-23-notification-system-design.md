# Atlas COC — Notification system design

**Date:** 2026-07-23  
**Status:** Approved — implemented  
**Decisions locked:** Queue managers = `SYSTEM_ADMIN` + `QUALITY_MANAGER`

## Goal

Reliable, bilingual (ar/en), event-driven notifications so state changes never depend on SMTP, emails never fire for rolled-back transactions, and clients/staff see in-app alerts with deep links.

## Non-goals

- Real ESP wiring (SendGrid/SES/etc.) — Phase 0 uses Mailpit via `EmailAdapter`
- Push / SMS / WhatsApp
- Building the full admin intake UI in this slice (callers will use `notify`; existing `submitRequest` is the first wire-up)

## Architecture

```
Domain mutation (same Prisma tx)
  → notify({ event, recipients, data }, tx)
      → resolve users
      → create Notification (IN_APP) when inAppEnabled
      → create NotificationOutbox rows (EMAIL) when email due
      → NotificationLog attempt rows as appropriate
Worker / cron
  → claim PENDING outbox
  → render React Email (locale) + plain text
  → EmailAdapter.send
  → NotificationLog + mark SENT|FAILED
SLA scanner (15m)
  → find at-risk / breached (skip RETURNED_TO_CLIENT, ON_HOLD)
  → notify(SLA_*)
```

### Why outbox

A state change must never be lost because SMTP was down, and an email must never be sent for a transaction that rolled back. Writing delivery intent in the same transaction as the domain write is the contract.

## Schema changes

### `NotificationOutbox` (new)

| Field | Type | Notes |
|---|---|---|
| id | cuid | |
| eventType | string | e.g. `REQUEST_SUBMITTED` |
| channel | `NotificationChannel` | typically `EMAIL` (in-app is sync in-tx) |
| userId | string? | recipient user when known |
| recipient | string | email address or user id string |
| locale | `ar` \| `en` | from user preference / org default (`ar`) |
| payload | Json | template data (requestNo, state, link, names, …) |
| status | `PENDING` \| `PROCESSING` \| `SENT` \| `FAILED` | |
| attempts | int | default 0 |
| nextAttemptAt | DateTime | backoff |
| lastError | string? | |
| providerMessageId | string? | |
| createdAt / updatedAt | DateTime | |

Indexes: `(status, nextAttemptAt)`, `(eventType, createdAt)`.

### Existing models (kept, used)

- `Notification` — in-app centre
- `NotificationLog` — every channel attempt (audit of delivery)
- `NotificationPreference` — per user × eventType (`emailEnabled`, `inAppEnabled`)

### Event catalogue (`src/lib/notification-events.ts`)

Expand to:

| Event | legalFinancial | Default recipients |
|---|---|---|
| `REQUEST_SUBMITTED` | no | Atlas `INTAKE_OFFICER` |
| `REQUEST_RETURNED` | no | creator + `CLIENT_OWNER` on org |
| `REQUEST_RESUBMITTED` | no | Atlas `INTAKE_OFFICER` |
| `REQUEST_ACCEPTED` | no | creator |
| `REQUEST_ASSIGNED` | no | assigned officer |
| `REPORT_ISSUED` | no | creator + owners |
| `INVOICE_ISSUED` | **yes** | `CLIENT_FINANCE` + owners |
| `PAYMENT_RECEIVED` | **yes** | client finance + Atlas `FINANCE` |
| `SLA_AT_RISK` | no | assignee + queue managers |
| `SLA_BREACHED` | no | assignee + queue managers |
| `COMMENT_ADDED` | no | other side of conversation |
| (existing prefs) `STATEMENT_OVERDUE`, `CREDIT_LIMIT` | **yes** | keep for company prefs UI |

**Queue managers (locked):** users with role `SYSTEM_ADMIN` or `QUALITY_MANAGER` on an Atlas organisation.

Legal/financial events always enqueue email regardless of `emailEnabled`.

Rename preference alias: company UI today may show `SLA_WARNING` — map to `SLA_AT_RISK` in catalogue (seed/prefs migration note in plan).

## API

### `notify(input, tx?)`

```ts
type NotifyInput = {
  event: NotificationEventType;
  /** Explicit user ids; if omitted, use recipientResolver(event, data) */
  recipients?: string[];
  data: {
    requestId?: string;
    requestNo?: string;
    state?: string;
    link: string;           // locale-agnostic path suffix, e.g. /client/requests/id
    titleEn: string;
    titleAr: string;
    bodyEn: string;
    bodyAr: string;
    // extra template fields
    [key: string]: unknown;
  };
};
```

Behaviour inside `tx` (required when called from a domain transaction):

1. Resolve unique active users (explicit ∪ resolver).
2. Load preferences for those users × event.
3. For each user:
   - If `inAppEnabled` (default true): `Notification.create`
   - If email due (`emailEnabled` or legal/financial) and user has email: `NotificationOutbox.create` (`PENDING`)
4. Write `NotificationLog` for in-app batch (`status: QUEUED|SENT` for in-app created in-tx).

Idempotency for SLA: before enqueue, skip if an outbox/notification for same `event` + `requestId` exists within a cooldown window (e.g. 12h for AT_RISK, 24h for BREACHED) or store `metadata.lastSlaNotifyAt` on request via outbox payload dedupe key `dedupeKey` unique partial index optional.

**Recommendation:** `dedupeKey` string nullable unique on outbox (`SLA_AT_RISK:requestId`) so scanner is safe.

### Recipient resolvers

`src/server/notifications/recipients.ts` — pure queries using the transaction client:

- intake officers, atlas finance, queue managers
- org owners / finance / creator
- assignee
- comment “other side”: if direction `ATLAS_TO_CLIENT` → client creator+owners; if `CLIENT_TO_ATLAS` → assigned officer or intake queue

### EmailAdapter

```ts
interface EmailAdapter {
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}
```

- `MailpitAdapter` — SMTP to `SMTP_HOST`/`SMTP_PORT` (defaults `localhost:1025`)
- Factory `getEmailAdapter()` reads env; never imports a commercial SDK in Phase 0

### Worker

- `src/server/notifications/worker.ts` — claim batch (`UPDATE … PENDING WHERE nextAttemptAt <= now LIMIT n`), render, send, log
- Dev: started from `instrumentation.ts` or a `npm run jobs` script with `node-cron` every ~30s for outbox + every 15m for SLA
- Backoff: attempts 1..5 → 1m, 5m, 15m, 1h, dead-letter `FAILED`

### SLA scanner

Every 15 minutes:

1. Load requests where `state` ∉ (`DRAFT`, `RETURNED_TO_CLIENT`, `ON_HOLD`, `CLOSED`, `CANCELLED`, `REPORT_ISSUED`) and `slaDueAt` not null
2. Elapsed ratio for Phase 0: `elapsed = now - submittedAt`, `window = slaDueAt - submittedAt`, `ratio = elapsed / window` (require `submittedAt` and `slaDueAt`). Requests without `submittedAt` are skipped.
3. `ratio >= 0.8` and `now <= slaDueAt` → `SLA_AT_RISK`
4. `now > slaDueAt` → `SLA_BREACHED`
5. `notify` with dedupe keys `SLA_AT_RISK:{requestId}` / `SLA_BREACHED:{requestId}` (unique on outbox `dedupeKey`)

Multi-return pause accounting (subtract time spent in `RETURNED_TO_CLIENT`) is deferred; skipping paused states is the hard rule for this slice.
## Email templates

- Package: `@react-email/components`
- Path: `src/emails/<event>/<locale>.tsx` (or one component with `locale` prop — prefer **one component per event** with `locale` to avoid drift; render sets `dir`)
- Arabic: root `dir="rtl"`, table layout, inline styles only
- Shared shell: Atlas green (`#519E53`) header bar, Montserrat-first stack: `'Montserrat', Arial, Helvetica, sans-serif`
- Required fields every template: request number (mono), current state label, single CTA button → `{APP_URL}/{locale}{link}`
- Plain text: `src/emails/<event>/plain.ts` or `renderPlain(data, locale)`

## In-app UI

### Bell (AppTopbar)

- Unread count badge
- Dropdown: last N notifications, grouped by calendar day (Intl)
- Row click → mark read + navigate `link`
- Mark all read
- Footer link to full page

### Full page

- Client shell: `/[locale]/client/notifications`
- Admin shell: `/[locale]/admin/notifications`
- Shared UI component `NotificationCentre`; thin page wrappers per shell (no shared URL — deep links in emails already encode `/client/…` or `/admin/…`).

### Server

- `getNotificationsForUser`, `markNotificationRead`, `markAllNotificationsRead`
- Scoped to `session.id` only — a user cannot read or mutate another user’s rows.
## Wire-up (this slice)

1. Replace inline `notification.createMany` in `submitRequest` with `notify({ event: 'REQUEST_SUBMITTED', … }, tx)`
2. Export helpers for future return/accept/assign/resubmit/comment actions
3. Company preferences UI: align event keys with expanded catalogue

## Env

```
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_FROM="Atlas COC <noreply@localhost>"
APP_URL=http://localhost:3000
# Optional — disable the in-process notification worker (default is ON)
# NOTIFICATIONS_WORKER=0
```

Document Mailpit: `docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`

## Permissions

- Reading/marking own notifications: authenticated user (no special permission)
- No user may mark another user’s notifications
- Recipient resolution is server-side only; clients cannot invent recipient lists for privileged events when calling public actions (actions pass event + entity ids; `notify` resolves)

## Testing (manual Phase 0)

1. Submit request → outbox + in-app for intake; Mailpit shows ar/en per officer locale
2. Stop SMTP → submit still succeeds; outbox stays PENDING; worker retries
3. SLA fixture with due soon → scanner emits AT_RISK once; RETURNED_TO_CLIENT skipped
4. Prefer-off email for non-legal event → in-app only; INVOICE_ISSUED still emails

## Open items closed in this doc

- Queue manager roles: **SYSTEM_ADMIN + QUALITY_MANAGER**
- Fee/base and admin UI: out of scope here
