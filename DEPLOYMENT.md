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

### Automated daily backups (bundled Postgres only)

`deploy/backup-db.sh` dumps the `db` container's database to `/opt/backups`
(gzip, reads `POSTGRES_USER`/`POSTGRES_DB` from the container itself, no
secrets in the script) and prunes anything older than 14 days. Install once:

```bash
chmod +x deploy/backup-db.sh
(crontab -l 2>/dev/null; echo "15 3 * * * $(pwd)/deploy/backup-db.sh") | crontab -
```

Adjust the container name inside the script if you're not using the default
`coc-db-1` / `atlas-db-1` naming from `docker-compose.droplet.yml` or
`docker-compose.prod.yml`.

## Production hardening (recommended)

- **Managed Postgres** — swap the bundled `db` service for DigitalOcean Managed
  Postgres (automated backups + pooling): set `DATABASE_URL` in `.env`, delete the
  `db` service and `depends_on` in `docker-compose.prod.yml`.
- **Storage** — keep `STORAGE_DRIVER=spaces`; the local disk is wiped on redeploy.
- **Antivirus** — set `AV_DRIVER=clamav` + a clamd sidecar to scan uploads.
- **Errors** — wire Sentry into `logger.error` (`src/lib/logger.ts`).
- **Firewall** — the setup script leaves only SSH/80/443 open; Postgres is on the
  internal Docker network only (never published to the host in prod compose).

Security headers (CSP, HSTS, X-Frame-Options, …) are already applied in
`next.config.ts`. CI (`.github/workflows/ci.yml`) runs typecheck + lint + test.
