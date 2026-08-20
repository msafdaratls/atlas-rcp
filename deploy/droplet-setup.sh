#!/usr/bin/env bash
# One-shot bootstrap for a fresh Ubuntu 22.04/24.04 DigitalOcean droplet.
# Installs Docker + Compose, opens the firewall for web + SSH, and brings the
# production stack up. Run as root (or with sudo) from the repo root:
#
#   ./deploy/droplet-setup.sh
#
# Prereqs done BEFORE running:
#   1. Repo is checked out on the droplet.
#   2. `.env` exists (cp .env.production.example .env && edit it).
#   3. APP_DOMAIN's DNS A record points at this droplet's public IP.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Run: cp .env.production.example .env && edit it." >&2
  exit 1
fi

# ── Docker Engine + Compose plugin ───────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# ── Firewall: allow SSH + HTTP/HTTPS only ────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  echo "==> Configuring UFW firewall…"
  ufw allow OpenSSH  || true
  ufw allow 80/tcp   || true
  ufw allow 443/tcp  || true
  ufw --force enable || true
fi

# ── Build + start the stack (Caddy auto-provisions TLS) ──────────────────────
echo "==> Building and starting the stack…"
docker compose -f docker-compose.prod.yml up -d --build

# ── Daily backups: installed here, not left as a manual step ────────────────
# backup-uploads.sh is a no-op error (exit 1, nothing written) if no
# atlas_uploads volume exists — harmless when STORAGE_DRIVER=spaces, but it
# still means a bad STORAGE_DRIVER config fails loudly in cron mail instead
# of silently having no backup at all.
echo "==> Installing daily backup cron (03:15, keeps 14 days in /opt/backups)…"
REPO_DIR="$(pwd)"
chmod +x deploy/backup-db.sh deploy/backup-uploads.sh
CRON_MARKER="# atlas-coc daily backups"
if ! crontab -l 2>/dev/null | grep -qF "$CRON_MARKER"; then
  (
    crontab -l 2>/dev/null
    echo "$CRON_MARKER"
    echo "15 3 * * * $REPO_DIR/deploy/backup-db.sh"
    echo "20 3 * * * $REPO_DIR/deploy/backup-uploads.sh"
  ) | crontab -
else
  echo "    (backup cron already installed — leaving crontab as-is)"
fi

echo
echo "==> Done. Watch startup with:"
echo "    docker compose -f docker-compose.prod.yml logs -f"
echo "==> Health check (after ~1 min for TLS):"
echo "    curl -fsS https://\$APP_DOMAIN/api/health"
