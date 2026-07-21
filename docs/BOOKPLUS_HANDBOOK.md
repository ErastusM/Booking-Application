# Bookplus — Application Handbook

_Operator & handover reference. Last updated: 2026-07-13._

Bookplus is a live, dual‑app appointment‑booking marketplace for Namibia / Southern
Africa. It is one backend serving two front ends: a **customer marketplace** (find &
book businesses) and a **business management suite** (calendar, clients, earnings,
staff) which also hosts the **admin console**.

> **Sensitive values (passwords, API keys, secrets) are NOT written in this document.**
> They live only in the server's `.env.production` file on the host. Where a credential
> is needed, this handbook tells you the variable name and how to read it on the server.

---

## 1. Live URLs

| Surface | URL | Notes |
|---|---|---|
| Customer marketplace | https://www.bookplus.pro | Apex `bookplus.pro` and `app.bookplus.pro` 301‑redirect here |
| Business + Admin app | https://business.bookplus.pro | Providers, staff **and admins** log in here |
| API | https://api.bookplus.pro | Backend (also serves sitemap/robots/prerender) |
| Public booking link | https://www.bookplus.pro/b/&lt;slug&gt; | Each business gets a shareable slug link |
| Sitemap / robots | https://www.bookplus.pro/sitemap.xml · /robots.txt | Auto‑generated |

---

## 2. Admin access

The admin account is **seeded automatically on server boot** from environment variables.
It is created only if no user with that email already exists — so it is re‑created after
a full data wipe, and it never overwrites an existing account.

**How to log in**

1. Go to **https://business.bookplus.pro/login**
2. Sign in with the **admin email + password** (the `ADMIN_EMAIL` / `ADMIN_PASSWORD`
   values from the host `.env.production`).
3. Admin console: **`/bkplus-command`** → https://business.bookplus.pro/bkplus-command
4. Product analytics / insights: **`/bkplus-command/insights`**

**How to read / rotate the admin credentials on the host**

```bash
# See the current admin email + name (safe to print):
docker exec bookplus-server printenv ADMIN_EMAIL ADMIN_NAME

# The password is ADMIN_PASSWORD in the host .env.production (not printed here on purpose).
# To CHANGE it: edit .env.production on the host, then either
#   (a) delete the existing admin user and restart to re-seed, or
#   (b) use the app's "forgot password" flow, or
#   (c) reset it directly in Mongo.
```

> Seed rules (from `apps/api/server.js`): role = `admin`, `isVerified: true`, provider =
> `local`. Optional `ADMIN_NAME` (default "Admin") and `ADMIN_PHONE`. If either
> `ADMIN_EMAIL` or `ADMIN_PASSWORD` is unset, seeding is skipped with a warning.

---

## 3. User roles

| Role | Where they use the product | What they can do |
|---|---|---|
| **customer** | www.bookplus.pro | Browse, book, manage appointments, waiting list, wallet, reviews |
| **provider** | business.bookplus.pro | Own calendar, services, hours, clients (CRM), earnings, wallet, team, booking link |
| **staff** | business.bookplus.pro | Scoped schedule (`/my-schedule`) under a provider |
| **admin** | business.bookplus.pro → `/bkplus-command` | Platform oversight, provider top‑ups, insights |

Auth is scoped per app: one email can hold **both** a customer and a business account;
each app signs you into the correct side. Cross‑subdomain SSO is handled by a
parent‑domain refresh cookie.

---

## 4. Stack & architecture

- **Backend** — Node/Express, MongoDB (Mongoose), JWT auth (short access token +
  rotating refresh token with `tokenVersion` + `jti`). Lives in `apps/api` (npm‑managed).
- **Frontends** — React 18 + Vite. `apps/customer` and `apps/business`.
- **Shared packages** (pnpm workspace) — `packages/api-client` (axios + refresh
  interceptor + domain services + telemetry, TypeScript), `packages/design-tokens`
  (colors/type/spacing), `packages/ui`, `packages/config`.
- **Fonts** — Plus Jakarta Sans (display) + Inter (body). **Colors** — orange `#f03e16`,
  black `#040505`, off‑white `#e6e8e7`.
- **Reverse proxy** — nginx (TLS via Let's Encrypt / certbot).

### Production containers (Docker Compose on one host)

| Container | Image | Purpose | Port |
|---|---|---|---|
| `bookplus-mongo` | `mongo:6.0` | Database (volume `mongo_data`) | internal |
| `bookplus-server` | `erastusm/bookplus-server` | API | 5000 |
| `bookplus-customer` | `erastusm/bookplus-customer` | Customer SPA (static) | 3000 (internal) |
| `bookplus-business` | `erastusm/bookplus-business` | Business SPA (static) | 3000 (internal) |
| `bookplus-nginx` | `nginx:alpine` | TLS + routing | 80 / 443 |
| `bookplus-backup` | `mongo:6.0` | Nightly mongodump | — |
| `certbot` | `certbot/certbot` | TLS cert renewal | — |

---

## 5. Repository layout

```
apps/
  api/        Express API (npm; own package-lock so CI tests what Docker ships)
  customer/   Vite React — www.bookplus.pro
  business/   Vite React — business.bookplus.pro (+ /bkplus-command admin)
packages/
  api-client/     axios instance, refresh interceptor, services, telemetry
  design-tokens/  tokens.css + tailwind preset (single source of colour/type)
  ui/             shared components (scaffold)
  config/         shared tsconfig
nginx/conf.d/bookplus.conf   reverse-proxy + prerender routing
docker-compose.yml           production stack
ops/backup/                  mongodump entrypoint + rotation
scripts/                     gen_icons.py, wipe_db.js, etc.
docs/                        this handbook + DUAL_APP_* design docs
```

---

## 6. Environment variables

Set in the host **`.env.production`** for the API (loaded by all containers via
`env_file`). Frontend `VITE_*` vars are **build‑time** (injected by CI into the image).

**Required (server refuses to boot without these):**

| Var | Purpose |
|---|---|
| `MONGODB_URI` | Mongo connection string |
| `JWT_SECRET` | Access‑token signing secret (≥32 chars in prod) |
| `REFRESH_TOKEN_SECRET` | Refresh‑token signing secret (≥32 chars in prod) |

**Core / auth:**
`NODE_ENV=production`, `PORT=5000`, `JWT_EXPIRE` (e.g. 15m), `REFRESH_TOKEN_EXPIRE`
(e.g. 30d), `CLIENT_URL` (comma‑separated CORS allow‑list), `PUBLIC_ORIGIN`
(canonical customer origin used for links), `BUSINESS_ORIGIN`, `SERVER_URL`,
`COOKIE_DOMAIN` (`.bookplus.pro` — enables cross‑subdomain SSO).

**Admin seed:** `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_PHONE`.

**Email (Resend HTTP API in prod):** `EMAIL_API_KEY` (Resend key), `EMAIL_FROM_NAME`.
_Legacy SMTP fallback:_ `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`.
`SUGGESTIONS_EMAIL` receives in‑app suggestions.

**Google OAuth (social login):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**Web Push (optional):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
Leave blank to disable push safely.

**Alerts / ops:** `ALERT_WEBHOOK_URL` (Slack/Discord webhook for server + client‑error
alerts), `LOG_LEVEL`.

**Frontend build‑time (GitHub Actions secrets → baked into images):**
`VITE_API_URL` (API origin, api‑client appends `/api`), `VITE_GOOGLE_MAPS_API_KEY`
(business onboarding map; falls back to a text address field if absent).

---

## 7. Deploy & CI/CD

**Push to `main` is the deploy trigger.** GitHub Actions (`.github/workflows`) then:

1. **test** — `npm test` in `apps/api` (Jest, in‑memory Mongo, ~319 tests).
2. **build‑and‑push** — builds 3 Docker images and pushes to Docker Hub
   (`erastusm/bookplus-{server,customer,business}`).
3. **deploy** — SSHes to the host, syncs `docker-compose.yml`,
   `nginx/conf.d/bookplus.conf` and `ops/`, then `docker compose pull` + `up`.

The API image bundles its own `package-lock`, so CI tests exactly what ships.
Feature work uses `feat/*` / `chore/*` branches → PR → CI → squash‑merge. The nginx
config is bind‑mounted and reloaded on recreate.

---

## 8. Operations runbook

All commands run **on the host**, addressing containers by name (work from any directory):

```bash
# Health
curl -s https://api.bookplus.pro/api/health          # {success, db:"connected", uptime}

# Logs (API)
docker logs --tail=200 -f bookplus-server

# Restart the API (re-seeds admin + re-runs boot migrations)
docker restart bookplus-server

# Restart everything / pull latest images
cd <deploy-dir-with-docker-compose.yml>
docker compose pull && docker compose up -d

# Full data reset (DESTRUCTIVE — clears every collection, keeps schema/indexes)
docker exec bookplus-server node scripts/wipe_db.js --yes
docker restart bookplus-server                        # re-seeds admin, rebuilds indexes
```

### Backups & disaster recovery

- **Nightly** `mongodump` runs in the `bookplus-backup` container → `./backups` on the
  host, with rotation. Optional S3‑compatible offsite copy.
- **Restore:** stop the API, `mongorestore --drop` the chosen dump into `bookplus-mongo`,
  restart the API. _Test‑restore a dump periodically — it has not been drilled yet._
- The database lives on **one host** (`mongo_data` volume). The nightly dump is the
  safety net against disk loss.

---

## 9. Key features (how the product works)

- **Booking** — customers pick a business → service → date/time; slots are on a fixed
  **1‑hour grid** (customer and business/manual bookings alike). Guest checkout is
  supported (no account; contact details captured at confirm, managed via a tokenized
  `/manage/<token>` link).
- **Waiting list** — join a full slot; when it frees, the next in line is auto‑promoted
  (atomic, race‑safe), notified (in‑app + push + email) and shown a celebratory moment
  on next app open.
- **Reminders** — automatic 24h / ~5h / 1h before each appointment (email + push +
  in‑app), sent by a cron job.
- **Wallet & payments** — provider wallets, top‑ups (admin), optional per‑provider
  wallet checkout; balances can expire on an opt‑in schedule. No card processor —
  in‑person / wallet based. Multi‑currency (business picks at signup; default NAD, N$).
- **Business onboarding** — a guided wizard (address + map pin → hours → services →
  photos → booking link) that produces the `/b/<slug>` share link.
- **Team / staff** — providers can invite staff with their own availability & scoped
  schedule; customers can pick a specific professional or "any available".
- **CRM, reviews, packages, blocked times, recurring bookings** — all supported in the
  business suite.
- **Social share cards** — sharing a `/b/<slug>` link on WhatsApp/Facebook/etc. unfurls
  with the business's name + photo (server‑rendered for crawlers; humans get the app).
- **Product analytics funnel** — see §10.
- **PWA + push** — both apps are installable; Web Push works when VAPID keys are set.

---

## 10. Product analytics (funnel)

A lightweight event pipe records the customer & onboarding funnels.

- **Ingest:** `POST /api/events` (public, rate‑limited, batched by the client).
  Events instrumented: `page_view`, `provider_view`, `booking_start`, `booking_confirm`,
  `onboarding_step`, `onboarding_complete`.
- **Read (admin):** `GET /api/events/summary?days=7` → totals, unique sessions, and the
  booking (view→start→confirm) + onboarding funnels. Surfaced under the admin insights
  page. Raw events auto‑expire after 180 days (TTL).

---

## 11. Background jobs (cron)

Both run inside the API and are guarded by a **Mongo distributed lock** (`CronLock`), so
only one instance fires per tick even if the API is scaled to multiple containers.

| Job | Schedule | What it does |
|---|---|---|
| Reminders | every 15 min | Sends the 24h / 5h / 1h reminders due in each window |
| Wallet expiry | daily 02:30 | Zeroes opted‑in wallet balances after inactivity |

---

## 12. Domains, DNS & TLS

- DNS A‑records: `bookplus.pro`, `www`, `api`, `business` → the host IP
  (`app.bookplus.pro` optional, redirects to www).
- TLS: Let's Encrypt via the `certbot` container (auto‑renew). nginx terminates TLS and
  proxies to the app containers.

---

## 13. Local development

```bash
pnpm install                 # root — apps + packages
# in apps/api:  npm ci  &&  npm run dev        (API on :5050 locally)
pnpm customer:dev            # customer on :3002
pnpm business:dev            # business on :3003
# or start.bat → option 3 (both servers)
```

- API tests: `npm test` in `apps/api`.
- E2E: `pnpm --filter @bookplus/customer test:e2e` (Playwright).
- Local `VITE_API_URL` points at `http://localhost:5050`.

---

## 14. Pending owner actions (recommended)

- [ ] Set **`ALERT_WEBHOOK_URL`** (Slack/Discord) so server + client‑error alerts page you.
- [ ] Add an **external uptime monitor** hitting `https://api.bookplus.pro/api/health`.
- [ ] Add **`VITE_GOOGLE_MAPS_API_KEY`** as a GitHub Actions secret (restricted to
      `business.bookplus.pro`) so the onboarding map renders; otherwise it falls back to a
      text address field. Requires a redeploy to take effect.
- [ ] **Test‑restore** a nightly backup to confirm the DR path.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Failed to load appointments" / stuck after a data wipe | Browser holds a session for a deleted user | Reload — the app now auto‑logs‑out (401) to login; sign in / sign up fresh |
| Onboarding map is a text box, not a map | `VITE_GOOGLE_MAPS_API_KEY` not set at build time | Add the GitHub secret + redeploy |
| No emails arriving | `EMAIL_API_KEY` (Resend) unset or invalid; email errors are swallowed | Check the key; check Resend dashboard |
| Push not delivered | VAPID keys unset, or user hasn't granted permission | Set `VAPID_*`; user must enable notifications |
| Share link shows generic card | Provider has no slug/photo yet, or fetched pre‑onboarding | Complete onboarding; card cache refreshes shortly |

---

## 16. Versions

- API: `1.0.0-rc.19` · Customer app: `0.2.0` · Business app: `0.2.0`
- Design docs: `DUAL_APP_ARCHITECTURE.md` (why/what), `DUAL_APP_SPEC.md` (how), `README.md`.

---

_Generated as an operator reference. Keep it in sync when env vars, URLs, or the deploy
flow change._
