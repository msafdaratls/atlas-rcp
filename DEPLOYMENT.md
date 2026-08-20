# Deploying Atlas RCP to a DigitalOcean Droplet

This gets you from an empty droplet to a live HTTPS site. TLS is fully automatic
(Caddy + Let's Encrypt) — no certbot, no manual renewal.

## What you need first

- A DigitalOcean **droplet** (Ubuntu 22.04/24.04, 2 GB RAM minimum — the build
  compiles Chromium-adjacent deps).
- A **domain** you control.
- (Recommended) A **DigitalOcean Space** (private bucket) for uploaded documents.
- (Recommended) An **SMTP/ESP** account (SES, Postmark, Resend) for emails.

## 1. Point DNS at the droplet

Create an **A record** for your domain (e.g. `atlas.example.com`) pointing at the
droplet's public IP. Do this first — Caddy needs it to issue the certificate.

## 2. Get the code onto the droplet

```bash
ssh root@YOUR_DROPLET_IP
git clone <your-repo-url> atlas && cd atlas
```

## 3. Configure `.env`

```bash
cp .env.production.example .env
nano .env
```

Fill the **REQUIRED** values:

| Variable | What to set |
|----------|-------------|
| `APP_DOMAIN` | your domain, e.g. `atlas.example.com` |
| `ACME_EMAIL` | your email (Let's Encrypt notices) |
| `AUTH_SECRET` | already generated in the template — or `openssl rand -base64 48` |
| `AUTH_URL`, `NEXT_PUBLIC_APP_URL` | `https://atlas.example.com` |
| `POSTGRES_PASSWORD` | a strong random password |
| `STORAGE_DRIVER` + `SPACES_*` | `spaces` + your Space credentials (durable storage) |
| `SMTP_*` | your ESP credentials |

## 4. Launch

```bash
./deploy/droplet-setup.sh
```

This installs Docker, opens the firewall (SSH + 80 + 443), builds the image, runs
`prisma migrate deploy`, and starts Postgres + app + Caddy. First boot takes a few
minutes (image build) plus ~30s for Caddy to obtain the certificate.

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

## 5. Verify

```bash
curl -fsS https://atlas.example.com/api/health
# {"status":"ok","db":"up",...}
```

Open `https://atlas.example.com` → redirects to `/ar`. Create the first admin via
your normal bootstrap (do **not** run `npm run db:seed` in production — it loads
demo data).

## Day-2 operations

```bash
# Update to latest code
git pull && docker compose -f docker-compose.prod.yml up -d --build

# Logs / status
docker compose -f docker-compose.prod.yml logs -f app
docker compose -f docker-compose.prod.yml ps

# Backup the bundled Postgres (skip if using Managed Postgres — it auto-backs up)
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U postgres atlas_rcp > backup-$(date +%F).sql
```

### Automated daily backups

`./deploy/droplet-setup.sh` installs both backup crons for you (03:15 DB,
03:20 uploads) — this section is only for a droplet that was already set up
before that step existed, or for re-installing by hand:

- `deploy/backup-db.sh` dumps the `db` container's database to `/opt/backups`
  (gzip, reads `POSTGRES_USER`/`POSTGRES_DB` from the container itself, no
  secrets in the script) and prunes anything older than 14 days. Skip this one
  if you've moved to Managed Postgres — it backs up on its own.
- `deploy/backup-uploads.sh` tars the `atlas_uploads` volume the same way —
  **only relevant when `STORAGE_DRIVER=local`** (the default). If you're on
  `STORAGE_DRIVER=spaces` there's no local volume to back up and this script
  exits with an error saying so; that's expected, not a bug.

```bash
chmod +x deploy/backup-db.sh deploy/backup-uploads.sh
(
  crontab -l 2>/dev/null
  echo "15 3 * * * $(pwd)/deploy/backup-db.sh"
  echo "20 3 * * * $(pwd)/deploy/backup-uploads.sh"
) | crontab -
```

Both scripts auto-detect the container/volume name (matching `...-db-1` /
`...atlas_uploads` regardless of the Compose project prefix), so they work
unmodified against either `docker-compose.droplet.yml` or
`docker-compose.prod.yml`.

**Either way, back up is not the same as durable.** Both scripts write to
`/opt/backups` on the *same droplet* as the data they're backing up — a disk
failure takes out both copies together. Copy `/opt/backups` off-droplet on a
schedule (e.g. `rclone`/`s3cmd` to a DigitalOcean Space) once this is running,
or better: move Postgres to Managed Postgres and uploads to Spaces, and this
whole section stops mattering.

## Production hardening (recommended)

- **Managed Postgres** — swap the bundled `db` service for DigitalOcean Managed
  Postgres (automated backups + pooling): set `DATABASE_URL` in `.env`, delete the
  `db` service and `depends_on` in `docker-compose.prod.yml`.
- **Storage** — set `STORAGE_DRIVER=spaces` in `.env`; the local disk isn't
  durable (wiped on volume loss, and only backed up if you've installed
  `backup-uploads.sh`). Neither compose file hardcodes the driver, so this is
  a pure `.env` change plus filling in `SPACES_*`.
- **Antivirus** — set `AV_DRIVER=clamav` + a clamd sidecar to scan uploads.
- **Errors** — wire Sentry (or equivalent) into `logger.error`
  (`src/lib/logger.ts`). Until then, `/admin/system-health`
  (`system:health` permission, SYSTEM_ADMIN only) surfaces notification and
  label-eval jobs that exhausted their retries — it's a stopgap, not a
  replacement for real alerting.
- **Firewall** — the setup script leaves only SSH/80/443 open; Postgres is on the
  internal Docker network only (never published to the host in prod compose).

Security headers (CSP, HSTS, X-Frame-Options, …) are already applied in
`next.config.ts`. CI (`.github/workflows/ci.yml`) runs typecheck + lint + test.
