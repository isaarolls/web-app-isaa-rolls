#!/usr/bin/env bash
# Backup completo del database (allegati inclusi). Uso:
#   DATABASE_URL=postgresql://... ./scripts/backup.sh [cartella]
set -euo pipefail
: "${DATABASE_URL:?Imposta DATABASE_URL}"
DIR="${1:-./backups}"
mkdir -p "$DIR"
FILE="$DIR/isa-manager-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" -f "$FILE"
echo "Backup creato: $FILE ($(du -h "$FILE" | cut -f1))"
# conserva gli ultimi 30 backup
ls -1t "$DIR"/isa-manager-*.dump 2>/dev/null | tail -n +31 | xargs -r rm --
