#!/bin/sh
# Nightly MongoDB backup with rotation and optional offsite upload.
# Runs inside the `backup` compose service (mongo image — mongodump included).
#
#   BACKUP_RETENTION_DAYS  local copies to keep (default 14)
#   S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY
#                          optional S3-compatible offsite target (DO Spaces,
#                          B2, R2, AWS). Uploads happen only when all are set
#                          and the aws CLI is available in the image.
set -eu

STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="/backups"
ARCHIVE="$OUT_DIR/bookplus-$STAMP.archive.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

echo "[backup] starting mongodump -> $ARCHIVE"
mongodump --uri="$MONGODB_URI" --archive="$ARCHIVE" --gzip
echo "[backup] done: $(du -h "$ARCHIVE" | cut -f1)"

# Rotate local copies
find "$OUT_DIR" -name 'bookplus-*.archive.gz' -mtime +"$RETENTION_DAYS" -delete
echo "[backup] rotation complete (keep ${RETENTION_DAYS}d): $(ls "$OUT_DIR" | wc -l) archive(s) on disk"

# Optional offsite (S3-compatible)
if [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ]; then
    if command -v aws >/dev/null 2>&1; then
        export AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY"
        aws s3 cp "$ARCHIVE" "s3://$S3_BUCKET/mongo/" ${S3_ENDPOINT:+--endpoint-url "$S3_ENDPOINT"}
        echo "[backup] offsite upload complete"
    else
        echo "[backup] S3 vars set but aws CLI missing — offsite SKIPPED" >&2
    fi
else
    echo "[backup] offsite not configured (set S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY) — local copy only"
fi
