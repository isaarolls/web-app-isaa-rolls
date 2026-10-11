#!/usr/bin/env bash
# Ripristino di un backup. ATTENZIONE: sostituisce tutti i dati del database indicato.
#   DATABASE_URL=postgresql://... ./scripts/restore.sh backups/isa-manager-AAAAMMGG-HHMMSS.dump
set -euo pipefail
: "${DATABASE_URL:?Imposta DATABASE_URL}"
FILE="${1:?Indica il file di backup}"
echo "Stai per SOSTITUIRE tutti i dati del database con il contenuto di: $FILE"
read -r -p "Scrivi RIPRISTINA per confermare: " ok
[ "$ok" = "RIPRISTINA" ] || { echo "Annullato."; exit 1; }
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$FILE"
echo "Ripristino completato. Riavvia il servizio web e controlla i dati."
