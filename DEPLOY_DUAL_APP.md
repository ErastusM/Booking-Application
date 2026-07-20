# Dual-app deploy topology (originally the Epic 1.4 rollout runbook)

Everything below the "owner steps" line is automated: CI builds and pushes
three images (`erastusm/bookplus-server`, `erastusm/bookplus-customer`,
`erastusm/bookplus-business`), syncs `docker-compose.yml` +
`nginx/conf.d/bookplus.conf` + `ops/` to the droplet, runs
`compose pull && up -d --force-recreate`, waits for the API healthcheck, and
executes the idempotent data migrations (`migrate_team_colors.js`,
`migrate_account_types.js`). See `.github/workflows/ci-cd.yml`.

## Owner steps (one-time — ✅ all complete; kept for rebuild-from-scratch)

1. **DNS** — ✅ done. A records for `www.bookplus.pro` and
   `business.bookplus.pro` point at the droplet, alongside the apex, `api.`
   and the legacy `app.` names. Keep the `app.` record: nginx 301s it to
   `www` for early bookmarks, and the TLS cert lists it as a SAN — deleting
   the record would break both the redirect and cert renewal.

2. **TLS** — ✅ done. The live certificate covers all five SANs. To re-issue
   from scratch, run the repo's `init-letsencrypt.sh` (its `domains` list
   must match the five names below — check it before running):
   ```bash
   cd /app && ./init-letsencrypt.sh
   ```
   (Or: `docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
   --expand -d bookplus.pro -d www.bookplus.pro -d api.bookplus.pro \
   -d app.bookplus.pro -d business.bookplus.pro` then `docker compose exec nginx nginx -s reload`.)

3. **API env** — ✅ done, and the deploy job now keeps it in shape
   idempotently on every deploy: it ensures `COOKIE_DOMAIN=.bookplus.pro`
   (refresh-cookie scope — sessions stay per side regardless, scoped by
   `accountType`), strips the retired `app.bookplus.pro` origin from
   `CLIENT_URL`, and appends `https://business.bookplus.pro` to it.

## What ships where

| Origin | Serves | Image |
|---|---|---|
| `bookplus.pro` (apex) | 301 → `www.bookplus.pro` | — (nginx) |
| `www.bookplus.pro` | customer marketplace (Vite) | `erastusm/bookplus-customer` |
| `app.bookplus.pro` | 301 → `www.bookplus.pro` (keeps early bookmarks working) | — (nginx) |
| `business.bookplus.pro` | provider/staff/admin suite (Vite) | `erastusm/bookplus-business` |
| `api.bookplus.pro` | the one shared API | `erastusm/bookplus-server` |

nginx also proxies `www.bookplus.pro/sitemap.xml` + `/robots.txt` to the API,
and rewrites social-crawler hits on `/b/` + `/providers/` to the API's
prerender endpoint for share cards.

## Legacy client — retired ✅

The CRA client no longer ships anywhere: `www` serves the customer app, there
is no `client` service in `docker-compose.yml`, and the `bookplus-client`
image is no longer built or pushed.
