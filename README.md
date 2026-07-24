# Atlas RCP

Bilingual (AR default / EN) regulatory compliance portal for Atlas Support & Services
(أطلس للمساندة والخدمات).

## Stack (fixed — do not substitute)

- Next.js 15 App Router + TypeScript strict
- Tailwind CSS v4 + shadcn/ui (new-york, CSS variables)
- Prisma + PostgreSQL
- Auth.js v5 (credentials, JWT sessions)
- next-intl (`ar` default, `en`) via `/[locale]/...`
- Zod, TanStack Table v8, React Hook Form, lucide-react, date-fns, sonner
- Local uploads: `./storage/uploads` behind `StorageAdapter`

## Project rules

Always-on Cursor rule: `.cursor/rules/atlas.mdc`

## Setup

1. Configure `.env` from `.env.example` (`DATABASE_URL`, `AUTH_SECRET`).
2. Start PostgreSQL.
3. Install & migrate:

```bash
npm install
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

For local iteration you may use `npx prisma migrate dev` instead of `deploy`.
Baseline schema lives in `prisma/migrations/20260724000000_init/`.

Open `http://localhost:3000` → redirects to `/ar`.

Notification worker starts with the Next.js process by default. Set
`NOTIFICATIONS_WORKER=0` to disable.

## Structure

```
src/app/[locale]/(public|client|admin)/
src/app/api/
src/components/ui/          # shadcn
src/components/atlas/       # composed UI
src/lib/                    # db, auth, storage, rbac, i18n
src/server/                 # server actions by domain
src/messages/{ar,en}.json
prisma/schema.prisma
prisma/seed.ts
```

## Deployment (DigitalOcean droplet)

The app ships a `Dockerfile` (built on the Playwright image so Chromium for PDF
generation and the Prisma engine platform match) and a `docker-compose.yml`
(PostgreSQL + app, notification worker running in-process).

```bash
cp .env.example .env      # set AUTH_SECRET, AUTH_URL (https), SMTP_*, SPACES_*
docker compose up -d --build
```

Compose runs `prisma migrate deploy` on start. Put a TLS-terminating reverse
proxy in front (see `deploy/nginx.conf.example`, or use Caddy / a DO load
balancer). Health probe: `GET /api/health` (200 when the DB is reachable).

**Production checklist**

- **Storage** — set `STORAGE_DRIVER=spaces` + `SPACES_*` so uploaded regulatory
  documents live in a *private* DigitalOcean Space, not the ephemeral droplet
  disk. Local disk is dev-only and not durable. Downloads stay behind the
  auth-gated `/api/storage` route in both modes.
- **Database** — prefer DigitalOcean Managed Postgres (backups + pooling) over
  the bundled container. Never run `npm run db:seed` in production (demo data).
- **Email** — set `SMTP_*` to a real ESP (SES / Postmark / Resend) and configure
  SPF/DKIM/DMARC.
- **Secrets** — `AUTH_SECRET` via `openssl rand -base64 48`; `.env` is gitignored.
- **Scaling** — the notification worker runs in-process. To run more than one
  web instance, set `NOTIFICATIONS_WORKER=0` and run the worker separately, or
  SLA scans and emails will fire multiple times.

Security headers (CSP, HSTS, X-Frame-Options, …) are applied in `next.config.ts`.
CI (`.github/workflows/ci.yml`) runs typecheck + lint + test on every PR.

## Notes

- No git commits until you explicitly ask.
- Notification worker starts by default in production/Node. Set `NOTIFICATIONS_WORKER=0` to disable.
