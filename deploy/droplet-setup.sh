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

echo
echo "==> Done. Watch startup with:"
echo "    docker compose -f docker-compose.prod.yml logs -f"
echo "==> Health check (after ~1 min for TLS):"
echo "    curl -fsS https://\$APP_DOMAIN/api/health"
