# Notification system — implementation plan (executed)

> Executed inline from approved design `docs/superpowers/specs/2026-07-23-notification-system-design.md`.

**Goal:** Event-driven notifications with transactional outbox, Mailpit email, in-app centre, SLA cron.

## Delivered

1. `NotificationOutbox` + `OutboxStatus` in Prisma schema
2. Expanded `NOTIFICATION_EVENTS` / `PREFERENCE_EVENTS` (`SLA_AT_RISK` replaces `SLA_WARNING`)
3. `src/server/notifications/{notify,recipients,email-adapter,worker,sla-scanner,jobs,queries}.ts`
4. React Email shell + render helpers (`src/emails/`)
5. Instrumentation + `npm run jobs`
6. Bell dropdown + `/client/notifications` + `/admin/notifications`
7. `submitRequest` wired through `notify(..., tx)`
8. `.env.example` SMTP / APP_URL / NOTIFICATIONS_WORKER

## Apply DB

```bash
npx prisma migrate dev --name notification_outbox
# or: npx prisma db push
```

## Mailpit

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```
