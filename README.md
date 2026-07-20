# Bookplus — dual-app appointment-booking platform

Bookplus is a **two-app product on one shared backend**, live in production for
salons, barbers, spas, beauty & wellness, clinics, trainers and other
service-based businesses:

- **Customer marketplace** — discover local providers and book in seconds
  (`www.bookplus.pro`). Guest checkout, real-time availability, wallet, reviews,
  waiting list.
- **Business management app** — providers, staff and admins run their calendar,
  services, clients, earnings and team (`business.bookplus.pro`).
- **Shared API** — one Node/Express/MongoDB backend serving both apps
  (`api.bookplus.pro`). Sessions are scoped per side: customer and business
  accounts are separate (`User.accountType`), so logging into one app never
  signs you into the other.

Each surface is a fully responsive website **and** an installable, app-like PWA
(bottom-tab nav, safe-area support, splash screen) with Android builds via
Capacitor.

Brand: orange `#f03e16` · black `#040505` · white `#e6e8e7` · Plus Jakarta Sans
(display) + Inter (body), self-hosted.

## Repository layout (pnpm monorepo)

```
├── apps/
│   ├── api/                # Express + MongoDB backend (npm-managed, own lockfile)
│   ├── customer/           # customer marketplace app (Vite + React 18)
│   └── business/           # business management app (Vite + React 18)
├── packages/
│   ├── design-tokens/      # tokens.css + tailwind preset — single source of truth for color/type/spacing
│   ├── api-client/         # TypeScript axios client + auth-refresh interceptor + domain services
│   ├── ui/                 # shared React components (BrandMark, …)
│   └── config/             # shared tsconfig
├── nginx/                  # reverse-proxy config synced to the host on deploy
├── ops/                    # nightly mongodump backup service
└── docker-compose.yml      # mongodb · server · customer · business · nginx · certbot · backup
```

The API is deliberately **npm-managed** (its own `package-lock.json`) so CI tests
exactly what the Docker image ships; the apps and shared packages are one pnpm
workspace.

## Tech stack

| Layer     | Technology |
|-----------|------------|
| Frontends | React 18, React Router v6, Vite, FullCalendar, CSS custom properties; Capacitor (Android) |
| Shared    | pnpm workspaces; TypeScript packages consumed by both apps |
| Backend   | Node.js, Express, Mongoose |
| Database  | MongoDB (nightly mongodump backups with retention) |
| Auth      | JWT (access + rotating refresh, `tokenVersion` revocation), per-side sessions (separate customer/business accounts, `accountType`-scoped refresh), Google OAuth option, role-based access |
| Email     | Resend HTTP API (port 443) when configured; skipped without credentials |
| Push      | Web Push (VAPID) — live in production; disabled without keys |
| Images    | Cloudinary uploads |
| SEO       | Dynamic sitemap.xml + robots.txt from the API; per-page meta/OpenGraph + JSON-LD |
| Tests     | Jest + Supertest + mongodb-memory-server (300+ API tests) · Playwright e2e (self-contained stack) |
| Deploy    | Docker image per app, nginx, certbot; GitHub Actions CI/CD (push to `main` deploys) |

## Getting started

### Prerequisites
- Node.js 20+, pnpm (`npm i -g pnpm`)
- MongoDB running locally (or a connection string)

### Install

```bash
pnpm install                # repo root — both apps + shared packages
cd apps/api && npm ci       # API (npm-managed)
```

### Environment

Server (`apps/api/.env` — see `apps/api/.env.example`):

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (5050 local, 5000 in Docker) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Token signing secrets (≥32 chars in prod) |
| `CLIENT_URL` | Comma-separated CORS allowlist / canonical origins |
| `PUBLIC_ORIGIN`, `BUSINESS_ORIGIN` | Canonical customer / business origins for links + auth redirects |
| `COOKIE_DOMAIN` | Refresh-cookie `Domain` scope (`.bookplus.pro`) — refreshes are `accountType`-scoped, so the cookie never bridges customer and business sessions |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (optional) |
| `EMAIL_API_KEY` | Resend HTTP email (optional — emails skipped when absent) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (optional) |
| `ALERT_WEBHOOK_URL` | Slack/Discord webhook for 5xx + frontend-error alerts (optional) |

Apps (`apps/{customer,business}/.env`): `VITE_API_URL` — the API **origin** only,
e.g. `http://localhost:5050` (the api-client appends `/api` itself). The business
app also takes `VITE_CUSTOMER_URL`; the map step takes `VITE_GOOGLE_MAPS_API_KEY`.

### Run

```bash
cd apps/api && npm run dev     # API on :5050

pnpm customer:dev              # customer app on :3002
pnpm business:dev              # business app on :3003
```

(`3000`/`5000` are taken by other local stacks; Bookplus runs on `3002`/`3003`/`5050`.)
Or `start.bat` → option 3 starts everything.

### Test & build

```bash
cd apps/api && npm test                        # API suite (in-memory MongoDB)
pnpm --filter @bookplus/customer test:e2e      # Playwright e2e — boots its own API + dev server

pnpm --filter @bookplus/customer build         # production builds
pnpm --filter @bookplus/business build
```

### Docker

```bash
docker compose up -d    # mongodb · server · customer · business · nginx · certbot · backup
```

Images `erastusm/bookplus-server`, `erastusm/bookplus-customer` and
`erastusm/bookplus-business` (the app images build from the repo root so they can
see `packages/*`, and bake in `VITE_API_URL` at build time). Every service
declares a Docker `healthcheck`; nginx fronts all three domains + terminates TLS.

## Roles

| Capability | Customer | Provider | Staff | Admin |
|------------|:--------:|:--------:|:-----:|:-----:|
| Discover providers & book (incl. **guest checkout**, no account) | ✅ | — | — | — |
| Reschedule / cancel own bookings; no-login manage via `/manage/:token` | ✅ | — | — | ✅ |
| Waiting list (queue position, auto-promotion, "slot opened" celebration) | ✅ | — | — | — |
| Reviews, intake/consent forms, prepaid wallet, memberships/packages | ✅ | sell | — | oversight |
| Service catalogue (sub-options, add-ons, buffers), availability, blocked time | — | ✅ | scoped | ✅ |
| Calendar (day/3-day/week/month, drag-to-reschedule), walk-in/group/recurring | — | ✅ | scoped | — |
| Appointment lifecycle incl. no-show + audit trail; per-appointment messaging | — | ✅ | ✅ | ✅ |
| Client CRM, earnings & operational insights (utilization, peaks, retention) | — | ✅ | — | ✅ |
| Multi-staff team (invite, per-staff availability/services, colour-coding) | — | ✅ | self | — |
| Platform oversight, analytics, user/service/appointment management | — | — | — | ✅ |
| Web push notifications (opt-in) | ✅ | ✅ | ✅ | ✅ |

Admins log into the business app; the admin console is role-gated at
`/bkplus-command` (+ `/insights`).

## Highlights

- **Guest checkout** — first-time visitors book without an account; contact
  captured at confirm, managed via an emailed `/manage/:token` link.
- **Booking flow** — service → add-ons → date & time with live availability and
  booked-slot greying → review & confirm, with a full-screen celebratory moment.
- **Provider calendar** — day/3-day/week/month, drag-to-reschedule with
  server-side conflict rejection, blocked time, buffers, recurring series, group
  bookings, walk-ins, per-staff scheduling and "any available" resolution.
- **Wallets** — prepaid client↔provider balances (provider/admin-approved
  top-ups) + a provider↔platform ledger. **No card processing** — money is
  collected in person; wallets are bookkeeping.
- **Discovery / SEO** — availability-first search, `/b/:slug` booking links,
  a dynamic sitemap of every provider, per-page meta/OpenGraph + LocalBusiness
  JSON-LD.
- **Comms** — email + Web Push (both fire-and-forget), waiting-list promotion
  push, reminders (24h/5h/1h).
- **Ops** — nightly Mongo backups, container healthchecks, zero-dep 5xx +
  frontend-error alerting, per-app error boundaries (see `MONITORING.md`).

## Intentionally omitted (product decisions, not gaps)

- **No online payment processing** — no checkout, cards, invoices, payouts,
  refunds or POS. Wallets and earnings are ledgers over money collected in person.
- **No inventory / stock / product management.**
- **No marketing campaigns / promotions / ads.**

## Known limitations

- Per-provider **social share cards** (Facebook/WhatsApp unfurls) still show the
  generic site card — Googlebot gets per-page tags, but non-JS scrapers would
  need prerendering (tracked follow-up).
- Reminder + wallet-expiry jobs run in-process on cron, and waitlist
  promotion runs inline when a slot frees up (no external queue); a
  Mongo-backed distributed lock (`apps/api/src/utils/lock.js`) plus atomic
  waitlist promotion make them safe across multiple API instances.
- Waitlist auto-promotion matches exact service + date + start time.
- Buffer times apply to new bookings' conflict checks; existing appointments'
  own buffers aren't retro-checked.

## Documentation

| Doc | What it covers |
|-----|----------------|
| `DUAL_APP_ARCHITECTURE.md` / `DUAL_APP_SPEC.md` | Why/what and how of the dual-app product (epics, acceptance criteria) |
| `ARCHITECTURE.md` / `DESIGN.md` / `PRODUCT.md` | System, design-system and product references |
| `DEPLOY_DUAL_APP.md` | Deploy topology (images, nginx, DNS, CI/CD) |
| `MONITORING.md` | Healthchecks + external uptime-monitor setup |
| `START_HERE.md` / `QUICK_REFERENCE.md` | Orientation page + command cheat sheet |

> **Status:** the dual-app restructure is complete and live — customer
> marketplace + business app on one backend, per-side account sessions,
> multi-staff scheduling, native builds, SEO and guest checkout all shipped.
