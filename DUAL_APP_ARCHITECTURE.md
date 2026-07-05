# Bookplus → Fresha-style Dual-App Architecture

> **Purpose of this document.** A high-level plan for restructuring Bookplus from a
> single role-switching web app into two focused products — a **Customer app** and a
> **Business (Provider) app** — sharing one backend, the way Fresha does. It is written
> to be handed to an implementing engineer/agent as a starting brief. It is deliberately
> high-level: it sets direction, boundaries, and phasing, and calls out the decisions that
> still need to be made. It is **not** a line-by-line spec.

---

## 1. TL;DR

**The hard part is mostly already done.** Bookplus already has:
- A **role-aware backend** (`customer` / `provider` / `admin`, JWT with `tokenVersion`, Stripe, MongoDB).
- **Role-separated frontend surfaces** — customers get discovery + booking; providers get a dashboard (calendar, services, availability, earnings). Today these live in *one* React app with a client-side role switcher.

So "make it like Fresha" is **mainly a frontend restructuring** (split one app into two focused apps on the same API), plus optional **native mobile apps** later. It is **not** a rewrite of the backend or data model.

**Recommended shape:**
- One backend API (keep the existing Express/Mongo, harden and version it).
- A **monorepo** with two web apps (`customer`, `provider`) + shared packages (UI, API client, design tokens).
- Migrate the build from **CRA → Vite** during the split (faster, modern, fixes part of the "slow load").
- Optionally use **Next.js for the customer marketplace** (SEO + fast first load — Fresha lives and dies by search discovery).
- **Phase in native mobile (React Native / Expo)** reusing the shared packages once the web split is stable.

---

## 2. How Fresha is structured (the reference model)

Fresha is two products on one platform:

| Product | Audience | Core surface |
|---|---|---|
| **Fresha for Customers** (marketplace) | End clients | Discover businesses by location/service/category, browse, book, pay, manage bookings, reviews, reminders. SEO-heavy web + native iOS/Android. |
| **Fresha for Business** ("Partner") | Salons/providers/staff | Calendar & appointments, POS/checkout, staff & rosters, services & pricing, inventory, clients CRM, reports, marketing, payments/payouts. Web + native iOS/Android. |

Underneath: **one shared backend + data model** (businesses, staff, services, appointments, clients, payments). The two apps are just different *lenses* on that data, with different navigation, feature depth, and branding emphasis.

**The key lesson:** don't fork the data or the API — fork the *experience*.

---

## 3. Where Bookplus is today

Grounded in the current codebase:

- **Backend:** Node/Express, MongoDB/Mongoose, JWT (access + refresh, `tokenVersion` revocation), Stripe. Already role-aware. Deployed via Docker Compose behind Nginx; images `bookplus-server` / `bookplus-client` on Docker Hub; CI/CD via GitHub Actions on push to `main`; domains `bookplus.pro` (web) + `api.bookplus.pro` (API).
- **Frontend:** React 18 + React Router v6, built with **CRA (react-scripts)**. One SPA serving both personas. Providers toggle `activeRole` between `provider` and `customer` views client-side.
- **Customer surface (already exists):** Home discovery feed, `/services` marketplace, provider profiles, `BookAppointment`, `MyAppointments`, `Wallet`, `WaitingList`, `Profile`.
- **Provider surface (already exists):** `ProviderDashboard` (calendar / services / availability / earnings), `ProviderAccount`, plus admin/analytics dashboards.

**Implication:** the split lines are *already visible in the route/page structure*. Most pages belong cleanly to one persona.

**One data-model gap to decide on:** Bookplus appears to model **one provider account = one business** (the provider *is* the business; no separate staff/employee entities with their own calendars). Fresha supports **multi-staff businesses**. Decide whether multi-staff is in scope (see §11).

---

## 4. Target architecture

```
                         ┌──────────────────────────────┐
                         │        Backend API            │
                         │  Express + MongoDB + Stripe   │
                         │  (single source of truth,     │
                         │   role-aware, versioned)      │
                         └───────────────┬───────────────┘
                                         │  HTTPS / JSON (shared API client SDK)
                 ┌───────────────────────┼───────────────────────┐
                 │                                               │
      ┌──────────▼───────────┐                       ┌───────────▼──────────┐
      │   Customer app        │                      │   Business app        │
      │  app.bookplus.pro     │                      │  business.bookplus.pro│
      │  (marketplace+booking)│                      │  (management suite)   │
      │  web (+ mobile later) │                      │  web (+ mobile later) │
      └───────────────────────┘                      └───────────────────────┘

      shared packages: design tokens · UI kit · API client · auth · utils
```

- **One identity, one login.** A person signs in once; their `role` decides the default landing app. A provider can still use the customer app with the same account (as today). Single sign-on across subdomains.
- **Two focused frontends**, each with its own navigation/IA, onboarding, and feature depth.
- **Shared everything underneath**: API, auth, data model, design system, and reusable UI.

---

## 5. Monorepo layout (recommended)

Use a monorepo (pnpm workspaces or Turborepo) so shared code is a real dependency, not a copy-paste:

```
bookplus/
├── apps/
│   ├── api/                # existing Express/Mongo backend (moved in as-is)
│   ├── customer/           # marketplace + booking (Vite or Next.js)
│   └── business/           # provider management suite (Vite)
├── packages/
│   ├── ui/                 # shared components (buttons, cards, calendar, modals)
│   ├── design-tokens/      # colors (gold/charcoal/off-white), fonts, spacing, radius
│   ├── api-client/         # typed SDK: auth, services, appointments, wallet, etc.
│   └── config/             # shared eslint / tsconfig / tailwind preset
└── ...
```

**Why:** the current app already has one design system and one axios layer — those become `design-tokens` + `api-client`, consumed identically by both apps. Fixes drift and duplication before it starts.

---

## 6. Shared vs per-app

| Shared (build once) | Per-app (distinct) |
|---|---|
| Backend API + data model | Navigation / information architecture |
| Auth & identity (login, refresh, session) | Feature surface & depth |
| Design tokens + core UI primitives | Onboarding flows |
| API client SDK | Home/landing & branding emphasis |
| Payments (Stripe), notifications | App-store presence (mobile) |
| Utilities (dates, money, slots) | Route maps |

---

## 7. Tech decisions (recommendations + rationale)

1. **Keep the backend** (Express/Mongo). It's already role-aware and battle-tested. Formalize it: API **versioning** (`/api/v1`), an **OpenAPI schema** (so the `api-client` SDK — and the two apps — can be generated/typed), and clean domain separation.
2. **Migrate CRA → Vite** for the web apps. CRA (react-scripts) is deprecated and slow; Vite gives much faster dev + builds and smaller output. This is also part of the **"slow load"** fix. Both `customer` and `business` become Vite apps.
3. **Consider Next.js for the *customer* app only.** Fresha's customer growth is SEO/discovery-driven; server-rendered marketplace pages (business profiles, service listings, city/category pages) load fast and rank in search. The **business app can stay a client-side SPA** (it's behind login; SEO irrelevant).
4. **Adopt TypeScript** in the shared packages at minimum (the `api-client` and `ui` benefit hugely). Apps can adopt incrementally.
5. **Native mobile: React Native + Expo**, Phase 2. Reuse `api-client` + business logic packages; native gives push notifications, home-screen presence, and secure token storage (Keychain/Keystore) — which also fixes the "logged out on mobile" pain properly.

---

## 8. Auth & identity across two apps

Single identity, works across both apps and (later) native:

- **One login**; `role` + a chosen `activeRole` decide which app/experience the user lands in. Providers retain access to the customer app.
- **Session persistence (this is where the current "login every time" bug gets fixed for good):**
  - **Longer-lived access token** (e.g. 7 days) so normal reopens don't require a refresh round-trip.
  - **Robust refresh** — the current single-use rotating refresh token is fragile across reopens/tabs; make rotation race-tolerant (keep recent token ids valid rather than hard-consuming on every refresh). `tokenVersion` still revokes on logout/password reset.
  - **Native apps** store tokens in secure storage (Keychain/Keystore), immune to browser storage eviction (iOS ITP is a real cause of web logouts).
- **SSO across subdomains** (`app.` / `business.`): shared parent-domain cookie or a token hand-off, so switching apps doesn't mean re-login.

---

## 9. Performance (baked in, not bolted on)

The rebuild is the moment to fix the "slow to load" complaint at the root:

- **Vite build** → smaller, faster bundles than CRA; real code-splitting per route.
- **Fonts:** drop the render-blocking CSS `@import`; load via `<link rel="preconnect">` + `<link>` in HTML, `font-display: swap`, and subset to the weights actually used.
- **Preconnect** to the API origin so the first data call is fast.
- **Customer marketplace:** SSR/edge (Next.js) for instant first paint + SEO; cache discovery/listing responses.
- **Images:** already on Cloudinary — enforce responsive sizes, modern formats (WebP/AVIF), and lazy-loading.
- **Route-based prefetch** for likely next steps (e.g. prefetch the booking flow from a provider profile).

---

## 10. Phased migration plan (low-risk, keep shipping)

- **Phase 0 — Extract shared packages (no user-visible change).** Pull the design tokens, axios/API layer, and reusable components out of the current app into `packages/*`. The current single app keeps working, now consuming its own shared packages. De-risks everything downstream.
- **Phase 1 — Split the web apps.** Stand up the monorepo; create `apps/customer` and `apps/business` (Vite); move each persona's existing pages into its app; wire up SSO. Deploy on `app.bookplus.pro` and `business.bookplus.pro`. Backend untouched. Retire the client-side role-switcher once both apps are live.
- **Phase 2 — Native mobile.** Expo apps for customer and business, reusing shared packages; add push, secure token storage, app-store builds.
- **Phase 3 — Marketplace polish & SEO.** (Optionally) move the customer app to Next.js for SSR/SEO; city/category/business landing pages; reviews and ratings surfaced for discovery.

Throughout: a **feature-parity checklist** per persona so nothing regresses during the split, and the backend/API stays the stable contract both apps build against.

---

## 11. Key decisions to make (before Phase 1)

1. **Multi-staff businesses?** Add a Staff/Team model (each with a calendar), or keep one-provider-per-business? This is the biggest data-model fork vs. Fresha.
2. **Monorepo tooling:** pnpm workspaces (simple) vs Turborepo (caching/orchestration at scale).
3. **Next.js for the customer app**, or keep both apps as Vite SPAs? (SEO need vs. simplicity.)
4. **Native now or later?** (Recommend later — Phase 2.)
5. **Domains:** `app.` / `business.` subdomains vs. path-based, and the SSO mechanism.
6. **TypeScript scope:** shared packages only, or the apps too?

---

## 12. Suggested first tasks for the implementer

1. Stand up the monorepo skeleton (workspaces) and move `server/` in as `apps/api` unchanged; confirm CI still builds/tests it.
2. Extract `packages/design-tokens` (the gold/charcoal/off-white system + Plus Jakarta Sans) and `packages/api-client` (typed wrapper over the existing endpoints) from the current React app.
3. Create `apps/customer` and `apps/business` as Vite apps that both consume the shared packages; render a trivial authenticated page in each to prove the shared auth/API path end-to-end.
4. Move one full flow into each app as a vertical slice — **book an appointment** (customer) and **the calendar/dashboard** (business) — to validate the boundaries before bulk-migrating.
5. Implement SSO + the session-persistence model from §8 (fixes "login every time").

---

*Backend, data model, and deployment pipeline stay the stable foundation; the work is almost entirely about splitting and sharpening the two front-end experiences on top of them.*
