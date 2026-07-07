#!/bin/sh
# Backup scheduler: run once immediately on boot (so a fresh deploy always
# has a recovery point), then daily at the configured hour.
set -eu
HOUR="${BACKUP_HOUR:-03}"

/ops/backup.sh || echo "[backup] initial run failed (will retry on schedule)" >&2

while :; do
    NOW=$(date +%H)
    if [ "$NOW" = "$HOUR" ]; then
        /ops/backup.sh || echo "[backup] scheduled run failed" >&2
        sleep 3660   # skip past the hour so it fires once per day
    fi
    sleep 300
done
