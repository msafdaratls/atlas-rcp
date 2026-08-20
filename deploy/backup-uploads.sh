#!/bin/sh
# Daily backup of the atlas_uploads Docker volume — only relevant when
# STORAGE_DRIVER=local (the default). Not needed on STORAGE_DRIVER=spaces:
# Spaces is durable object storage and isn't sitting on this droplet's disk.
#
# Named volumes have no host path to read directly, so this tars the volume's
# contents via a throwaway container. Keeps 14 days locally, same rotation as
# backup-db.sh.
set -eu

BACKUP_DIR=/opt/backups
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"

VOLUME=$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)atlas_uploads$' | head -1)
if [ -z "$VOLUME" ]; then
  echo "ERROR: no atlas_uploads Docker volume found (docker volume ls). Nothing to back up — is STORAGE_DRIVER=spaces already?" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v "$VOLUME":/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/uploads-$STAMP.tar.gz -C /data ."

# Keep 14 days of daily backups.
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +14 -delete

echo "$(date -Iseconds) uploads backup written: $OUT ($(du -h "$OUT" | cut -f1))" >> "$BACKUP_DIR/backup.log"
