# Bookplus — Premium Appointment Booking Platform

A full-stack MERN appointment booking platform for salons, spas, barbers, beauty businesses, wellness providers, clinics, trainers, consultants, and other service-based businesses.

Works as a fully responsive website **and** an installable, app-like PWA with bottom-tab navigation, safe-area support, and mobile-first booking flows.

> **Note:** This product is intentionally **booking-only**. There is no billing, payments, checkout, wallets, earnings tracking, revenue reporting, invoices, payouts, refunds, subscriptions, or POS. Service prices are optional display information only.

## Tech Stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, React Router v6, FullCalendar, CSS custom properties (+ Tailwind base) |
| Backend  | Node.js, Express, Mongoose |
| Database | MongoDB |
| Auth     | JWT (access + refresh) with Google OAuth option, role-based access control |
| Email    | Nodemailer (Gmail app password) — only sends when credentials are configured |
| Images   | Cloudinary uploads |
| Tests    | Jest + Supertest + mongodb-memory-server (100 tests) |
| Deploy   | Docker (client + server images), nginx, certbot |

## Getting Started

### Prerequisites
- Node.js 18+
- MongoDB running locally (or a connection string)

### Install

```bash
# Server
cd server && npm install

# Client
cd client && npm install
```

### Environment Variables

Server (`server/.env` — see `server/.env.example`):

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Token signing secrets |
| `JWT_EXPIRE`, `REFRESH_TOKEN_EXPIRE` | Token lifetimes |
| `CLIENT_URL`, `SERVER_URL` | Origins for CORS / OAuth redirects |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth (optional) |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail app password (optional — emails are skipped when absent) |

Client (`client/.env`):

| Variable | Purpose |
|----------|---------|
| `REACT_APP_API_URL` | API base URL, e.g. `http://localhost:5000/api` |

### Run

```bash
# Terminal 1 — API on :5000
cd server && npm run dev

# Terminal 2 — React app on :3000
cd client && npm start
```

Or use the included `.bat` launcher (option 3 starts both).

### Test & Build

```bash
# Server unit/integration suite (Jest + in-memory MongoDB)
cd server && npm test

# End-to-end suite (Playwright). Boots a self-contained API on an
# in-memory MongoDB + the CRA dev server automatically — no external
# Mongo or running stack required. First run only:
cd client && npx playwright install chromium
cd client && npm run test:e2e        # headless
cd client && npm run test:e2e:ui     # interactive UI mode

# Production client build
cd client && npm run build
```

### Docker

```bash
docker compose up -d        # mongo, server, client, nginx, certbot
```

Images: `erastusm/bookplus-server`, `erastusm/bookplus-client` (client build bakes in `REACT_APP_API_URL`).

## User Roles

| Capability | Customer | Provider | Admin |
|------------|----------|----------|-------|
| Browse providers & book | ✅ | — | — |
| Reschedule / cancel own bookings | ✅ | — | ✅ |
| Join waiting list | ✅ | — | — |
| Review completed appointments | ✅ | — | — |
| Complete intake / consent forms before a visit | ✅ | — | — |
| Manage service catalogue (sub-options, buffers, categories) | — | ✅ | ✅ |
| Availability, blocked time, breaks | — | ✅ | — |
| Calendar (day/week/month, drag-to-reschedule) | — | ✅ | — |
| Walk-in / group / recurring bookings | — | ✅ | — |
| Confirm / complete / no-show / cancel appointments | — | ✅ | ✅ |
| Client CRM (history, notes) & messaging | — | ✅ | — |
| Earnings reporting (completed-appointment value) | — | ✅ | — |
| Operational insights (utilization, peak hours, retention) | — | ✅ | — |
| Build intake / consent / consultation forms | — | ✅ | — |
| Memberships (session bundles, no payment) | — | ✅ | — |
| Team management | — | ✅ | — |
| User / service / appointment oversight | — | — | ✅ |
| Non-financial analytics | — | — | ✅ |
| Push notifications (opt-in, any role) | ✅ | ✅ | ✅ |

## Main Features

### Customer
- Provider discovery with search, location filter, and GPS **Near me**
- Booking flow: service → sub-option (e.g. Adults / Students) → add-ons → date & time (live availability and booked-slot greying) → review & confirm — **no payment step**
- Sticky mobile confirm bar, free cancellation, reschedule, rebook, Google Calendar links
- Waiting list with queue position and automatic promotion when slots open
- Reviews on completed appointments

### Provider
- Fresha-quality calendar: day/week/month views, drag-to-reschedule with server-side conflict rejection, blocked-time bottom-sheet on mobile
- Appointment lifecycle: pending → confirmed → completed / cancelled / **no-show**, with a status audit trail (`statusHistory`)
- Recurring appointments (daily/weekly/monthly) with series cancel (this / future / all)
- Group bookings (multiple clients, one slot)
- Service catalogue: categories, mutually exclusive sub-options, optional display price, duration, **buffer before/after**
- **Business Overview** tab: today's bookings, upcoming, completed, clients served, popular services, status breakdown, waiting-list queue, recent activity
- **Earnings** tab: value of completed appointments by date range — totals, this/last month + growth, avg per appointment, by service, over time, top clients, recent completed, CSV export (reporting only — no payment/payout logic)
- **Insights** tab: utilization (booked vs available), no-show & cancellation rates, new vs returning clients, peak hours, busiest days, bookings over time, CSV export
- **Forms** tab: build intake / consent / consultation forms with a field builder, attach to services, view submissions
- Client CRM, in-app messaging, memberships (session bundles), team members
- Onboarding wizard with GPS address autofill

### Admin
- User / provider / service / appointment management with search and filters
- Review and suggestion oversight
- Non-financial analytics: bookings over time, status breakdown, new users, popular services, busiest days, service ratings

### Platform
- Dark mode (single ThemeContext source of truth, `--ink` token system)
- PWA: manifest, app icons, installable, standalone display, safe-area insets
- **Web push notifications** (opt-in toggle in settings) — fire on booking/cancel/reschedule/waitlist/reminders; disabled by default and only active when VAPID keys are configured
- Intake/consent forms customers complete before a visit, with completion status on the appointment and client profile
- Route-level code splitting (main bundle ~83 KB gzipped)
- Email + push notifications sent fire-and-forget — booking responses don't wait on SMTP; both are skipped entirely without credentials
- Rate limiting, JWT auth, input validation (express-validator), role checks on all protected endpoints
- End-to-end tested with Playwright (auth, booking, cancellation, discovery) against a self-contained in-memory stack

## Intentionally Omitted

These are product decisions, not gaps:

- **No payments/billing** — no checkout, card processing, wallets, mobile money, receipts, payment history, invoices, payouts, refunds, deposits, taxes, tips, subscriptions, or POS. `Appointment.paymentStatus`/`paymentIntentId` remain in the schema as deprecated fields only.
- **Earnings reporting is display-only** — the provider Earnings tab summarises the value of *completed* appointments (collected in person). There is no payment capture, payout, balance, or transaction ledger behind it.
- **No inventory / stock / product management.**
- **No marketplace discovery** — provider profile pages are shareable links, not a global browsing marketplace.
- **No marketing campaigns / promotions / ads.**

## Known Limitations

- Buffer times apply to new bookings' conflict checks; existing appointments' own buffers are not retro-checked.
- Waitlist auto-promotion matches exact service + date + start time (no fuzzy "any time that day" matching yet).
- Reminder jobs run in-process (no external queue) — fine for a single server instance.
- Group bookings share one slot without per-member staff assignment.

## Recommended Next Steps

1. Push notifications (service worker) for booking events.
2. Intake/consent forms attached to services.
3. Provider utilization and peak-hours analytics with date-range filters + CSV export.
4. Multi-location support for businesses with several branches.
5. E2E tests (Playwright) for the booking and calendar flows.
