# Database backups

## What runs

| Service | What it does |
|---|---|
| `backup` | `mongodump` of the whole database once when it starts and every night at `BACKUP_HOUR` (default 03 UTC) into `/app/backups` on the server. Keeps `BACKUP_RETENTION_DAYS` (default 14). |
| `backup-offsite` | Every hour copies new archives to `OFFSITE_REMOTE`, encrypted. Alerts (log + `ALERT_WEBHOOK_URL`) when the newest backup is over 26 hours old or a copy fails. |
| Every deploy | Takes a backup before changing anything; the deploy stops if it fails. |

A copy that only lives on the droplet is lost with the droplet, so set up
off-site copies (below) and also turn on **DigitalOcean → Droplet → Backups**.

## Turn on encrypted off-site copies (DigitalOcean Spaces)

1. DigitalOcean → Spaces: create a bucket, e.g. `bookplus-backups`, in a region
   other than the droplet's if possible. Keep it private.
2. API → Spaces Keys: create a key pair for it.
3. Choose a long random encryption passphrase and store it in your password
   manager. **Without it the backups can never be decrypted.** Then, on the
   server, turn it into rclone's stored form:
   `docker run --rm rclone/rclone:1.68 obscure 'THE-PASSPHRASE'`
4. Add to `/app/.env.production` with a text editor (not `echo`):

   ```
   RCLONE_CONFIG_SPACES_TYPE=s3
   RCLONE_CONFIG_SPACES_PROVIDER=DigitalOcean
   RCLONE_CONFIG_SPACES_ENDPOINT=<region>.digitaloceanspaces.com
   RCLONE_CONFIG_SPACES_ACCESS_KEY_ID=<key>
   RCLONE_CONFIG_SPACES_SECRET_ACCESS_KEY=<secret>
   RCLONE_CONFIG_SECURE_TYPE=crypt
   RCLONE_CONFIG_SECURE_REMOTE=spaces:bookplus-backups/mongo
   RCLONE_CONFIG_SECURE_PASSWORD=<output of step 3>
   OFFSITE_REMOTE=secure:
   ```
5. `cd /app && docker compose up -d backup-offsite`, then
   `docker logs bookplus-backup-offsite` should end with `copy complete`.

## Prove a backup restores

GitHub → Actions → **Backup restore test** → Run workflow. It backs up,
restores into a throwaway container on the server (never the live database),
and compares totals with the live database.

## Restore for real (disaster recovery)

1. Stop the API so nothing writes: `docker compose stop server`
2. Copy the archive in and restore over the live database:
   `docker cp backups/<file>.archive.gz bookplus-mongo:/tmp/r.gz`
   `docker exec bookplus-mongo sh -c 'mongorestore --uri="$MONGODB_URI" --archive=/tmp/r.gz --gzip --drop'`
   (`--drop` replaces each collection with the backup's copy.)
3. `docker compose start server`

From an off-site copy: `docker run --rm --env-file .env.production -v $PWD/restore:/restore rclone/rclone:1.68 copy secure: /restore`
first, then use the file from `./restore`.
