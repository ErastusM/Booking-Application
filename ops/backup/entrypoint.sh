#!/bin/sh
# Backup scheduler: run once immediately on boot (so a fresh deploy always
# has a recovery point), then daily at the configured hour.
# Scripts are run with `sh` explicitly: /ops is a read-only bind mount and the
# files were not executable on the server, so `/ops/backup.sh` failed with
# "Permission denied" on every run from July to October 2026 (no backups).
set -eu
HOUR="${BACKUP_HOUR:-03}"

sh /ops/backup.sh || echo "[backup] initial run failed (will retry on schedule)" >&2

while :; do
    NOW=$(date +%H)
    if [ "$NOW" = "$HOUR" ]; then
        sh /ops/backup.sh || echo "[backup] scheduled run failed" >&2
        sleep 3660   # skip past the hour so it fires once per day
    fi
    sleep 300
done
