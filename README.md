# Bookplus — Premium Appointment Booking Platform

A full-stack appointment-booking platform for salons, spas, barbers, beauty and
wellness businesses, clinics, trainers, consultants, and other service-based
businesses. Customers discover providers and book in seconds; providers run
their calendar, services, clients, and earnings from one dashboard.

Works as a fully responsive website **and** an installable, app-like PWA with
bottom-tab navigation, safe-area support, and mobile-first booking flows.

Brand: orange `#f03e16` · black `#040505` · white `#e6e8e7`, Plus Jakarta Sans.

> **In progress:** Bookplus is being restructured into a dual-app product — a
> customer marketplace app and a business management app on one shared backend.
> See `DUAL_APP_ARCHITECTURE.md` (direction) and `DUAL_APP_SPEC.md` (epics,
> acceptance criteria).

## Repository layout (pnpm monorepo)

```
├── apps/
│   └── api/                # Express + MongoDB backend (npm-managed)
├── client/                 # React 18 web app (CRA; workspace member)
├── packages/
│   ├── design-tokens/      # tokens.css + tailwind preset — color/type/spacing source of truth
│   ├── api-client/         # TypeScript axios client + auth refresh + domain services
│   ├── ui/                 # shared React components (BrandMark, …)
│   └── config/             # shared tsconfig
└── docker-compose.yml      # mongo, api, client, nginx, certbot
```

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, React Router v6, FullCalendar, CSS custom properties (+ Tailwind base) |
| Shared   | pnpm workspaces; TypeScript packages consumed by the app(s) |
| Backend  | Node.js, Express, Mongoose |
| Database | MongoDB |
| Auth     | JWT (access + rotating refresh, `tokenVersion` revocation), Google OAuth option, role-based access |
| Email    | Resend HTTP API when `EMAIL_API_KEY` is set; SMTP fallback; skipped entirely without credentials |
| Images   | Cloudinary uploads |
| Tests    | Jest + Supertest + mongodb-memory-server (185 tests) · Playwright e2e (12 specs, self-contained stack) |
| Deploy   | Docker images per app, nginx, certbot; GitHub Actions CI/CD (push to `main` deploys) |

## Getting Started

### Prerequisites
- Node.js 20+, pnpm (`npm i -g pnpm`)
- MongoDB running locally (or a connection string)

### Install

```bash
pnpm install                # repo root — client + shared packages
cd apps/api && npm install  # API (npm-managed until Epic 1)
```

### Environment

Server (`apps/api/.env` — see `apps/api/.env.example`):

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Token signing secrets |
| `JWT_EXPIRE`, `REFRESH_TOKEN_EXPIRE` | Token lifetimes |
| `CLIENT_URL`, `SERVER_URL` | Origins for CORS / OAuth redirects |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (optional) |
| `EMAIL_API_KEY` | Resend HTTP email (optional — emails skipped when absent) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push (optional — push disabled when absent) |

Client (`client/.env`): `REACT_APP_API_URL` — API **origin** only, e.g.
`http://localhost:5000` (the api-client appends `/api` itself).

### Run

```bash
# Terminal 1 — API
cd apps/api && npm run dev

# Terminal 2 — web app
cd client && npm start
```

Or `start.bat` / `start.sh` → option 3 starts both.

### Test & Build

```bash
cd apps/api && npm test              # API suite (in-memory MongoDB)

cd client && npx playwright install chromium   # first run only
cd client && npm run test:e2e        # e2e — boots its own API + dev server
cd client && npm run test:e2e:ui    # interactive mode

pnpm --filter bookplus-client build  # production client build
```

### Docker

```bash
docker compose up -d        # mongo, api, client, nginx, certbot
```

Images: `erastusm/bookplus-server` (built from `apps/api/`) and
`erastusm/bookplus-client` (built from the repo root so it can see
`packages/*`; bakes in `REACT_APP_API_URL`). CI builds and pushes both on every
push to `main`, then auto-deploys over SSH.

## User Roles

| Capability | Customer | Provider | Admin |
|------------|----------|----------|-------|
| Discover providers & book | ✅ | — | — |
| Reschedule / cancel own bookings | ✅ | — | ✅ |
| Waiting list (queue position, auto-promotion) | ✅ | — | — |
| Reviews on completed appointments | ✅ | — | — |
| Intake / consent forms before a visit | ✅ | — | — |
| Prepaid wallet with a provider (top-ups, balance) | ✅ | approve | oversight |
| Memberships / session packages | purchase & redeem | sell & track | — |
| Service catalogue (sub-options, add-ons, buffers) | — | ✅ | ✅ |
| Availability, blocked time, breaks | — | ✅ | — |
| Calendar (day/week/month, drag-to-reschedule) | — | ✅ | — |
| Walk-in / group / recurring bookings | — | ✅ | — |
| Appointment lifecycle incl. no-show + audit trail | — | ✅ | ✅ |
| Client CRM (history, notes) & per-appointment messaging | — | ✅ | — |
| Earnings & operational insights (utilization, peaks, retention) | — | ✅ | — |
| Team members (calendar color-coding) | — | ✅ | — |
| Platform wallet (provider ↔ platform balance) | — | ✅ | ✅ |
| User / service / appointment oversight, analytics | — | — | ✅ |
| Web push notifications (opt-in) | ✅ | ✅ | ✅ |

## Highlights

- **Booking flow**: service → sub-option → add-ons → date & time with live
  availability and booked-slot greying → review & confirm; sticky mobile
  confirm bar; no-login booking management via emailed `/manage/:token` links.
- **Provider calendar**: day/week/month, drag-to-reschedule with server-side
  conflict rejection, blocked time, buffers, recurring series (cancel
  this/future/all), group bookings, walk-ins.
- **Wallets**: prepaid client↔provider balances with provider/admin-approved
  top-ups and adjustments, plus a provider↔platform ledger. **No card
  processing** — money is collected in person; wallets are bookkeeping.
- **CRM & comms**: client history and notes, per-appointment chat, email +
  web-push notifications (both fire-and-forget; disabled without credentials).
- **Analytics**: business overview, earnings by range with CSV export,
  utilization, no-show/cancellation rates, peak hours, retention.
- **Platform**: dark mode (token-driven), PWA install, route-level code
  splitting, rate limiting, input validation, role checks on every protected
  endpoint.

## Intentionally omitted (product decisions, not gaps)

- **No online payment processing** — no checkout, cards, invoices, payouts,
  refunds, or POS. Wallets and earnings are ledgers over money collected in
  person.
- **No inventory / stock / product management.**
- **No marketing campaigns / promotions / ads.**

## Known limitations

- Buffer times apply to new bookings' conflict checks; existing appointments'
  own buffers are not retro-checked.
- Waitlist auto-promotion matches exact service + date + start time.
- Reminder jobs run in-process (no external queue) — fine for one instance.
- Group bookings share one slot without per-member staff assignment (staff
  scheduling becomes first-class in the dual-app Epic 2).

## Roadmap

The dual-app restructure (`DUAL_APP_SPEC.md`): Epic 0 monorepo extraction ✅ →
Epic 1 split customer/business apps + SSO → Epic 2 multi-staff scheduling →
Epic 3 marketplace SEO + native mobile.
