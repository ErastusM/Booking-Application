# Dual-app rollout runbook (Epic 1.4)

Everything below the "owner steps" line is automated: CI builds and pushes
four images (`bookplus-server`, `bookplus-client`, `bookplus-customer`,
`bookplus-business`), syncs `docker-compose.yml` + `nginx/conf.d/bookplus.conf`
to the droplet, runs `compose pull && up`, and executes the idempotent data
migrations.

## Owner steps (one-time, BEFORE merging the Epic 1 branch)

1. **DNS** — add two A records pointing at the droplet's IP:
   - `www.bookplus.pro`
   - `business.bookplus.pro`

2. **TLS** — the existing certificate only covers the current three names.
   After DNS resolves, re-issue with the two new SANs (the repo's
   `init-letsencrypt.sh` already lists all five domains):
   ```bash
   cd /app && ./init-letsencrypt.sh
   ```
   (Or: `docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
   --expand -d bookplus.pro -d www.bookplus.pro -d api.bookplus.pro \
   -d app.bookplus.pro -d business.bookplus.pro` then `docker compose exec nginx nginx -s reload`.)

3. **API env** — append to `/app/.env.production`:
   ```bash
   COOKIE_DOMAIN=.bookplus.pro     # SSO refresh cookie scope
   # CLIENT_URL is comma-separable; add the new origins:
   CLIENT_URL=https://www.bookplus.pro,https://bookplus.pro,https://www.bookplus.pro,https://business.bookplus.pro
   ```

## What ships where

| Origin | Serves | Image |
|---|---|---|
| `www.bookplus.pro` | legacy single app (retires after parity sign-off) | `bookplus-client` |
| `www.bookplus.pro` | customer marketplace (Vite) | `bookplus-customer` |
| `business.bookplus.pro` | provider/staff/admin suite (Vite) | `bookplus-business` |
| `api.bookplus.pro` | the one shared API | `bookplus-server` |

## Retiring the legacy client

Once the split apps are signed off in production: point `www` at the customer
app (nginx change), drop the `client` service from compose, and remove
`client/` from the repo. Until then all three frontends run side by side —
same API, same sessions (SSO cookie).
