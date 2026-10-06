#!/bin/sh
# Off-site, encrypted copies of the nightly database backups.
#
# Runs in the `backup-offsite` compose service (rclone image). Every hour it
# copies new archives from /backups (read-only) to OFFSITE_REMOTE. Point that at
# an rclone "crypt" remote so the copies are encrypted before they leave this
# server; rclone is configured entirely from environment variables in
# .env.production (see ops/backup/README.md). With OFFSITE_REMOTE unset it
# only reports that off-site copies are not configured.
#
# It also watches freshness: if the newest local backup is older than 26 hours
# (the nightly job has stopped working), it says so loudly and, when
# ALERT_WEBHOOK_URL is set, posts an alert there.
set -u

alert() {
    echo "[offsite] ALERT: $1" >&2
    if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
        msg=$(printf '%s' "Bookplus backups: $1" | sed 's/"/\\"/g')
        wget -q -O /dev/null --header 'Content-Type: application/json' \
             --post-data "{\"text\":\"$msg\"}" "$ALERT_WEBHOOK_URL" || true
    fi
}

while :; do
    newest=$(ls -1t /backups/bookplus-*.archive.gz 2>/dev/null | head -n1)
    if [ -z "$newest" ]; then
        alert "no database backup exists on the server"
    elif [ -n "$(find "$newest" -mmin +1560 2>/dev/null)" ]; then
        alert "the newest database backup is more than 26 hours old ($(basename "$newest"))"
    fi

    if [ -z "${OFFSITE_REMOTE:-}" ]; then
        echo "[offsite] not configured (set OFFSITE_REMOTE and the RCLONE_CONFIG_* variables) — backups exist on this server only"
    elif rclone copy /backups "$OFFSITE_REMOTE" --include 'bookplus-*.archive.gz' --min-age 5m --stats-one-line -v >/tmp/rclone.log 2>&1; then
        tail -n 2 /tmp/rclone.log; echo "[offsite] copy complete"
    else
        tail -n 5 /tmp/rclone.log >&2; alert "copying backups off-site failed"
    fi
    sleep 3600
done
