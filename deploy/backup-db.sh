#!/bin/sh
# Daily Postgres backup for the COC app database.
# Dumps from inside the coc-db-1 container (reads its own POSTGRES_USER/DB env
# vars, so no secrets need to live in this script) and keeps 14 days locally.
set -eu

BACKUP_DIR=/opt/backups
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/coc-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

docker exec coc-db-1 sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$OUT"

# Keep 14 days of daily backups.
find "$BACKUP_DIR" -name 'coc-*.sql.gz' -mtime +14 -delete

echo "$(date -Iseconds) backup written: $OUT ($(du -h "$OUT" | cut -f1))" >> "$BACKUP_DIR/backup.log"
