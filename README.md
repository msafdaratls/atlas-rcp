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

## Notes

- No git commits until you explicitly ask.
- Notification worker starts by default in production/Node. Set `NOTIFICATIONS_WORKER=0` to disable.
