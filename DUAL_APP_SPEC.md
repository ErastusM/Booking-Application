# Bookplus Dual-App — Full Technical Spec

> Companion to **`DUAL_APP_ARCHITECTURE.md`** (the high-level "why/what"). This document is
> the detailed "how": per-app route maps, the multi-staff data-model changes, API versioning,
> and a concrete, ordered task breakdown for the implementing engineer/agent. It is grounded in
> the current codebase (models, routes, and auth as they exist today), so tasks reference real
> files and endpoints.

---

## 0. Current-state facts this spec builds on

- **No separate Business entity.** A provider is a `User` with `role: 'provider'`; the "business" is the embedded `User.businessProfile` (`businessName`, `description`, `address`, `locationType`, `teamSize`, `likesCount`). Every business-owned resource references the provider **User** directly (`Service.provider`, `Availability.provider`, `BlockedTime.provider`, `Category.provider`, `Package.provider`, `Wallet.provider`, `ClientNote.provider`, `FormTemplate.provider`, `TeamMember.provider`, `Appointment.provider`).
- **Auth:** middleware `auth` (verify JWT, load `req.user`, reject suspended, check `tokenVersion`) + `authorize(...roles)`. Roles enum = **`customer | provider | admin`** only. JWT access token (`{id, tokenVersion}`) + rotating refresh token (`refreshTokenJtis`).
- **`TeamMember` is a roster stub:** `provider(ref User)`, `name`, `role`(free-text title), `email`/`phone`(plain strings), `color`, `isActive`. **No login, no availability, no service mapping.**
- **Booking today:** the provider is derived from the chosen `Service.provider`; `Appointment.teamMember` is optional and only set when a provider assigns a chair from their own calendar. `booked-slots` and availability checks are **provider-wide**, never per-staff.
- **Rich domain already present:** Appointment (recurrence, groups, walk-ins, `manageToken`, payment status/method), Service (`options`, `addOns`, `bufferBefore/After`), Availability (per-provider, unique), BlockedTime (per-provider), Package/ClientPackage (memberships), Review, FormTemplate/FormSubmission (intake/consent), ClientNote (CRM), Message (per-appointment chat), WaitingList, Notification, PushSubscription, Category, and **two wallet ledgers** (client↔provider `Wallet`, provider↔platform `ProviderWallet`).

**Consequence:** the backend is already ~80% of a Fresha-class platform. The dual-app work is mostly (a) splitting the frontend, (b) upgrading multi-staff from a label to a first-class actor, and (c) hardening/versioning the API.

---

## 1. Monorepo & app topology

```
bookplus/
├── apps/
│   ├── api/            # existing server/ moved in unchanged; add /api/v1 + OpenAPI
│   ├── customer/       # marketplace + booking — Vite SPA (or Next.js, see §7)
│   ├── business/       # provider + staff management suite — Vite SPA
│   └── admin/          # (decision) small internal ops app, or a gated area of business
├── packages/
│   ├── api-client/     # typed SDK generated from OpenAPI; wraps auth + refresh
│   ├── ui/             # shared components (buttons, cards, calendar, modal, sheet)
│   ├── design-tokens/  # gold #c9a84c / charcoal #1a1a2e / off-white #fafaf8, Plus Jakarta Sans, spacing/radius/shadow
│   └── config/         # shared eslint / tsconfig / tailwind preset / vite preset
└── package.json        # pnpm workspaces (recommended) or Turborepo
```

Deployment: three (or two) web targets on subdomains — `app.bookplus.pro` (customer), `business.bookplus.pro` (business), optional `admin.bookplus.pro`; API stays `api.bookplus.pro`. Reuse the existing Docker + GitHub Actions pipeline, one image per app.

---

## 2. Per-app route maps

Legend: **(exists)** = a current page maps here; **(new)** = net-new.

### 2a. Customer app — `app.bookplus.pro`
| Route | Purpose | Source |
|---|---|---|
| `/` | Discovery feed (social-style browse) | Home (exists) |
| `/search` | Marketplace: filter by category/location/service | ProvidersPage / `/services` (exists) |
| `/c/:category` , `/city/:city` | SEO landing pages (category/location) | (new — SEO) |
| `/b/:providerId` | Business public profile (services grouped, reviews, portfolio) | ProviderProfilePage (exists) |
| `/b/:providerId/book` | Booking flow: service → **staff (or "any")** → date/time → confirm | BookAppointment (exists) + staff step (new) |
| `/appointments` | My bookings (upcoming/past) | MyAppointments (exists) |
| `/appointments/:id` | Booking detail: reschedule/cancel, chat, forms, review | (consolidate existing) |
| `/wallet` | Client↔provider prepaid balances + top-ups | Wallet (exists) |
| `/packages` | My purchased packages + redeem | (new UI over ClientPackage) |
| `/favorites` | Saved businesses | (new UI over `User.favorites`) |
| `/messages` | Conversations (customer side) | (new UI over Message) |
| `/profile`, `/profile/edit` | Account, preferences, push opt-in | Profile (exists) |
| `/login /register /forgot-password /reset-password /verify-email /auth/callback` | Auth | (exists) |
| `/manage/:token` | No-login manage a booking | ManageBooking (exists, public) |
| `/about /privacy-policy /terms` | Marketing/legal | (exists) |
| CTA → `/become-a-business` | Hand-off to business onboarding | BecomeProvider (exists) |

### 2b. Business app — `business.bookplus.pro`
| Route | Purpose | Source | Access |
|---|---|---|---|
| `/` | Today's calendar / dashboard home | ProviderDashboard (exists) | provider, staff (own column) |
| `/calendar` | Day/week calendar with **per-staff columns/filter** | ProviderDashboard calendar (exists) + staff lanes (new) | provider(all), staff(self) |
| `/appointments` | List + history + status changes | (exists) | provider(all), staff(self) |
| `/services` | Services CRUD; `options`/`addOns`/buffers; **assign staff** | ProviderDashboard services (exists) + staff assign (new) | provider/admin |
| `/availability` | **Business hours** | Availability (exists) | provider/admin |
| `/team` | Staff roster CRUD, **invite to log in**, **per-staff hours**, **service assignment** | TeamMember (exists) + big upgrade (new) | provider/admin |
| `/clients`, `/clients/:id` | CRM: client list, notes, history, packages, forms | clientCRM/ClientNote (exists) | provider/admin, staff(assigned) |
| `/packages` | Package offerings CRUD + holders | Package (exists) | provider/admin |
| `/forms` | Intake/consent templates + submissions | FormTemplate/FormSubmission (exists) | provider/admin |
| `/earnings` | Earnings (+ **per-staff breakdown**, new) | earnings (exists) | provider/admin |
| `/wallet` | Client wallets held + top-up approvals + adjustments | walletRoutes provider side (exists) | provider/admin |
| `/platform-wallet` | Provider↔platform balance + top-ups | providerWallet (exists) | provider |
| `/messages` | Conversations (provider side) | Message (exists) | provider, staff(assigned) |
| `/reviews` | Reviews of my services | reviewRoutes provider side (exists) | provider/admin |
| `/waitlist` | Provider waitlist | waitingList provider side (exists) | provider/admin |
| `/analytics` | Provider analytics | AnalyticsDashboard/analytics (exists) | provider/admin |
| `/settings` | Business profile, wallet settings, portfolio, onboarding | ProviderAccount (exists) | provider/admin |
| Onboarding `/setup` | Provider setup wizard | provider-setup (exists) | provider |

### 2c. Admin — decision (§9)
Current admin routes `/bkplus-command` + `/bkplus-command/insights` handle user management, wallet approvals, platform analytics. **Recommendation:** a small separate `admin.bookplus.pro` app (or a `role:admin`-gated area inside `business`). Keep out of the customer bundle regardless.

---

## 3. Multi-staff data-model changes (the core upgrade)

**Recommended approach: extend, don't rebuild.** Keep "provider User = business owner." Promote `TeamMember` from label to first-class actor, and add per-staff scheduling. (A full `Business`/`Location` entity extraction is only needed for **multi-location** — treat that as a separate, later decision; see §9.)

### 3.1 `User` — add a staff principal
```js
role: { enum: ['customer', 'provider', 'staff', 'admin'] }   // + 'staff'
// staff-only: which business (provider User) they work for
staffOf: { type: ObjectId, ref: 'User', default: null }
// optional granular permissions for staff (owner assigns)
staffPermissions: { type: [String], default: [] }  // e.g. ['calendar:self','clients:assigned','services:none']
```

### 3.2 `TeamMember` — link to a login + services
```js
user:     { type: ObjectId, ref: 'User', default: null }   // null = roster-only (no login); set = has a staff login
services: [{ type: ObjectId, ref: 'Service' }]             // which services this staff performs; [] = all business services
// keep: provider, name, role(title), email, phone, color, isActive
```
- A staff member with `user == null` is exactly today's behavior (assignable on the calendar, no login).
- Inviting a staff member creates/links a `User{role:'staff', staffOf: provider}` and sets `TeamMember.user`.

### 3.3 New `StaffAvailability` — per-staff hours (mirrors `Availability`)
```js
StaffAvailability {
  provider:   { ref User, required },              // business owner (for scoping/queries)
  teamMember: { ref TeamMember, required, unique }, // one schedule per staff
  schedule:   { monday..sunday: { enabled, slots:[{start,end}] } },
}
// Absence of a doc → staff inherits business hours (Availability).
```

### 3.4 `BlockedTime` — optional per-staff scope
```js
teamMember: { type: ObjectId, ref: 'TeamMember', default: null }  // null = business-wide (today's behavior)
```

### 3.5 `Appointment` — already staff-aware; formalize
- Keep `teamMember: ref TeamMember`. Already has per-staff overlap detection (`overlapQuery.teamMember = teamMember || null`). No schema change required; just always set it once customer booking has a staff step. Optionally rename references to `staff` in new code (keep the DB field `teamMember` for back-compat).

### 3.6 Availability resolution (the new booking math)
For staff **S**, service **V**, date **D**, a slot is bookable iff it is:
1. within **business hours** (`Availability` for the provider on D), **and**
2. within **staff hours** (`StaffAvailability` for S, else inherit business hours), **and**
3. not inside a **business-wide** `BlockedTime` (`teamMember: null`) **nor** a staff `BlockedTime` (`teamMember: S`), **and**
4. free of overlapping `Appointment`s for `(provider, teamMember: S)` including `Service.bufferBefore/After`, **and**
5. long enough for `V.duration + buffers`.
"Any available" = union of steps 1–5 across all staff who perform V (`TeamMember.services` empty or includes V), returning the earliest-available staff per slot.

### 3.7 Migration & back-compat
- Existing appointments with `teamMember: null` remain valid = "the owner performs it." Owner is implicitly staff-index-0.
- Existing single-provider businesses keep working with zero staff records (booking falls back to provider-level availability, exactly as today).
- Add data migration: optionally create one `TeamMember` per existing provider representing the owner, linked to their `User`, so calendars are uniform. Guard everything behind feature detection (staff count > 0).

---

## 4. API changes

### 4.1 Versioning
- Mount all existing routers under **`/api/v1`** in `server.js`; keep `/api/*` as a temporary alias (proxy to v1) so current clients don't break. Announce a deprecation window.
- Publish **OpenAPI 3** for v1 (start from the endpoint list in the architecture map). Generate `packages/api-client` types from it so both apps are type-safe against the same contract.

### 4.2 New / changed endpoints (all under `/api/v1`)
Staff management (business app):
- `POST /team/:id/invite` — create/link a `User{role:'staff'}`, email an invite; (provider/admin)
- `GET|PUT /team/:id/availability` — staff hours (`StaffAvailability`); (provider/admin, or staff-self)
- `PUT /team/:id/services` — set `TeamMember.services`; (provider/admin)
- `GET|POST|PUT|DELETE /blocked-times?teamMember=:id` — extend existing to accept staff scope

Booking (customer app) — **breaking behavior, additive params:**
- `GET /appointments/booked-slots?providerId=&teamMember=&date=` — segment busy times by staff (extend current provider-wide query)
- `GET /providers/:id/staff?serviceId=` — list bookable staff for a service (new, public) → powers the staff-selection step
- `POST /appointments` — accept `teamMember` from the customer flow (currently only provider-set); when omitted with multi-staff, resolve "any available"

Calendar (business app):
- `GET /appointments?teamMember=:id` — staff-scoped calendar (extend `getAllAppointments`); enforce staff can only query self unless provider/admin

Auth (staff):
- Reuse `/auth/login`; `/auth/profile` returns `staffOf`, `role:'staff'`, `staffPermissions`. `authorize` gains staff-ownership checks (a staff principal is scoped to `staffOf` and, for calendar/clients, to their own assignments).

### 4.3 Auth-hardening (also fixes "login every time" — see architecture §8)
- Access token lifetime → **7 days** (default in `server/src/utils/helpers.js`; update the paired unit test).
- Refresh: make rotation **race-tolerant** — do not hard-consume the presented jti on every refresh; rely on the capped `refreshTokenJtis` list + `tokenVersion` for revocation.
- Native apps (later) store tokens in secure storage; web keeps `localStorage` + preconnect.

---

## 5. Shared packages (contents)
- **`design-tokens`**: CSS variables + Tailwind preset for the gold/charcoal/off-white palette, Plus Jakarta Sans (loaded via `<link preconnect>` not `@import` — see perf), spacing/radius/shadow scales. Single source both apps import.
- **`ui`**: Button, Card, Modal/Sheet, Calendar (extract the provider calendar + the booking month grid), form inputs, StatusBadge, Avatar, EmptyState. Themed via `design-tokens`.
- **`api-client`**: typed methods per domain (auth, services, appointments, availability, team, wallet, packages, forms, crm, reviews, messages, notifications, push) over one axios instance with the shared refresh interceptor (extract from current `services/api.js`). Consumed identically by web now and native later.
- **`config`**: eslint, tsconfig, tailwind preset, vite preset.

---

## 6. Performance (concrete, baked in)
- **Build:** CRA → **Vite** for both apps (faster builds, real per-route code-splitting, smaller output). Customer app optionally **Next.js** for SSR/SEO on `/`, `/search`, `/c/:category`, `/b/:id`.
- **Fonts:** remove the render-blocking `@import` in `index.css`; use `<link rel="preconnect" href="fonts.gstatic.com" crossorigin>` + `<link rel="stylesheet" ...>` in HTML, `font-display: swap`, subset to used weights.
- **Preconnect** to `api.bookplus.pro`.
- **Images:** Cloudinary responsive sizes + WebP/AVIF + lazy-load; explicit dimensions to avoid layout shift.
- **Data:** cache discovery/listing responses; route-based prefetch (prefetch booking bundle from a profile page).

---

## 7. Phased delivery + Fable 5 task breakdown

Each epic lists ordered tasks with **acceptance criteria (AC)** and file pointers. Ship epics in order; the app stays working throughout.

### Epic 0 — Monorepo & shared extraction (no user-visible change)
- **0.1** Create pnpm workspace; move `server/` → `apps/api` (unchanged); confirm CI builds/tests. **AC:** existing server tests pass in the new path.
- **0.2** Extract `packages/design-tokens` from the current CSS variables + fonts. **AC:** current app renders identically consuming the package.
- **0.3** Extract `packages/api-client` from `client/src/services/*` (incl. the refresh interceptor in `services/api.js`). **AC:** current app uses it with no behavior change.
- **0.4** Extract `packages/ui` starting with the calendar + booking grid + common inputs.

### Epic 1 — Split the web apps
- **1.1** Scaffold `apps/customer` and `apps/business` as **Vite** apps consuming the shared packages.
- **1.2** Move customer pages (§2a) into `apps/customer`; provider/admin pages (§2b/2c) into `apps/business`. **AC:** feature parity per the route maps; a parity checklist is green.
- **1.3** Implement **SSO across subdomains** + the token-lifetime/refresh hardening (§4.3). **AC:** logging in on one app authenticates the other; a user staying within 7 days is never forced to re-login.
- **1.4** Deploy to `app.` / `business.` subdomains; retire the client-side role-switcher. Keep `/api` alias live.

### Epic 2 — Multi-staff as a first-class actor
- **2.1** Schema: add `'staff'` role + `staffOf`/`staffPermissions` to `User`; add `user`+`services` to `TeamMember`; add `StaffAvailability`; add `teamMember` to `BlockedTime` (§3). **AC:** migrations run; existing single-provider flows unchanged.
- **2.2** API: staff invite/link, staff availability, staff service assignment; extend `booked-slots`, add `GET /providers/:id/staff`, extend calendar filter (§4.2). **AC:** endpoints covered by tests.
- **2.3** Booking math: implement the availability resolution (§3.6) incl. "any available." **AC:** two staff can hold the same clock slot; a staff's blocked time removes only that staff's slots.
- **2.4** Business app UI: `/team` upgrade (roster, invites, per-staff hours, service assignment), per-staff calendar lanes, staff-scoped login view. **AC:** an invited staff logs into `business` and sees only their calendar + assigned clients.
- **2.5** Customer app UI: staff-selection step in the booking flow (service → staff/"any" → time). **AC:** customer can pick a stylist and see that stylist's real openings.

### Epic 3 — Marketplace & mobile
- **3.1** (Optional) migrate `apps/customer` to Next.js; add SEO landing pages (§2a) + SSR for profiles. **AC:** business profiles are server-rendered and indexable.
- **3.2** React Native / Expo apps (customer + business) reusing `api-client` + business logic; push + secure token storage. **AC:** both apps build for iOS/Android against the same API.

---

## 8. Decisions to lock before Epic 2
1. **Multi-location?** If yes, extract a real `Business`/`Location` entity (bigger migration) instead of provider-User-as-business. If no (recommended for now), keep provider-User-as-business + Staff.
2. **Staff permission granularity** — fixed presets (own-calendar-only vs manager) or per-permission flags (`staffPermissions`).
3. **Admin app** — separate `admin.bookplus.pro` vs gated area of `business`.
4. **Next.js for customer** — SEO gain vs. keeping both apps as Vite SPAs.
5. **Monorepo tool** — pnpm workspaces (simple) vs Turborepo (build caching).
6. **TypeScript scope** — shared packages only, or apps too.

---

## 9. Risk notes
- **Booking-slot correctness** is the highest-risk change (Epic 2.3): it touches money and double-booking. Cover with tests mirroring `bookingSlots` + the concurrent-write race guard already in `appointmentController`.
- **`/api` → `/api/v1`**: keep the alias until all clients (incl. the no-login `/manage/:token` links already in the wild) are migrated.
- **Two wallet ledgers** must land in the correct app: client wallet (`Wallet`) → customer app; provider↔platform (`ProviderWallet`) → business app; approvals span both provider and admin.
- **Don't fork data or auth** — one API, one identity. The split is experience-only.
```
