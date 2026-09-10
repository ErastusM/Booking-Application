# Prompt: Migrate Bookplus to Ionic React + Capacitor

> Engineering brief for a coding agent (or team) to transform the Bookplus web
> apps into cross-platform Ionic React + Capacitor apps shipping to iOS,
> Android, and web from one codebase — **without discarding the design system.**
> This brief is grounded in a subsystem-by-subsystem analysis of the real repo;
> the risks below were verified against the actual code and Ionic/Capacitor docs.

---

## Role & context

You are a senior front-end engineer executing a framework migration on the
**Bookplus** appointment-booking platform. Read `CLAUDE.md`,
`DUAL_APP_ARCHITECTURE.md`, and `DUAL_APP_SPEC.md` before you start.

pnpm workspace, two React 18 + Vite front-ends + one Node/Express API:
- `apps/customer` — marketplace (`@bookplus/customer`, :3002, React 18 + Vite,
  React Router **v6**, 21 flat routes, 15 lazy pages, PWA with boot splash,
  `--safe-top` safe-area handling, web-push, fresh-build reload).
- `apps/business` — provider/staff/admin suite (`@bookplus/business`, :3003,
  same stack + `@fullcalendar/*` + `@react-google-maps/api`, nested admin route
  `/bkplus-command/insights`).
- `apps/api` — Node/Express/MongoDB. **Not in this migration's scope to rewrite,
  BUT it has two hard blockers this migration depends on — see "Backend
  dependencies" below. Coordinate those from day one.**

Shared packages (must keep working): `packages/design-tokens` (`tokens.css`
CSS custom properties + a Tailwind preset that is effectively dead code),
`packages/api-client` (axios, `withCredentials: true`, JWT access + rotating
refresh, `tokenVersion`), `packages/ui` (router-free), `packages/config`.

Brand: orange `#f03e16`, black `#040505`, white `#e6e8e7`. Fonts:
`var(--font-display)` = Plus Jakarta Sans, `var(--font-body)` = Inter.

## Objective

Adopt **Ionic React** (`@ionic/react`, `@ionic/react-router`) + **Capacitor** so
both apps run as native **iOS + Android** apps and installable PWAs from one
React 18 codebase, with the Bookplus design tokens remaining the styling source
of truth. Both apps are equal, required deliverables.

## Decisions (CONFIRMED 2026-07-14)

- **✅ Router: adopt `@ionic/react-router` (React Router v5).** The full-Ionic
  path: native stack transitions + `IonTabs` routing. It requires a v6→v5
  **down-conversion** (see Risk 1), de-risked by the Phase-2 adapter. (The
  considered alternative — keep v6, use Ionic UI + Capacitor only — was declined
  in favour of the full-Ionic experience.)
- **✅ Platform rendering: adaptive** (`setupIonicReact()`, no fixed `mode`) —
  iOS renders Cupertino, Android renders Material.
  *Accepted trade-off:* adaptive renders different radii/shadows/ripple per
  platform, which fights the "one rhythm everywhere" token scale and doubles
  visual QA (2 apps × 2 platforms × light/dark) — budget for that QA in Phase 6.

## Hard constraints (do not violate)

1. **Design tokens win over Ionic defaults — bridge, don't replace.** See "Token
   bridge" below; it is NOT a 1:1 alias.
2. **Web stays shippable at every commit.** Push-to-`main` auto-deploys both web
   apps (CI → Docker Hub → SSH compose up). Every merged PR is a production web
   release. Native code paths stay gated behind `Capacitor.isNativePlatform()`.
3. **Preserve behavior:** auth + JWT refresh, web-push, boot splash, `--safe-top`,
   fresh-build reload, SEO, FullCalendar + Google Maps, all routes, guest
   checkout on `/book-appointment` + `/complete-profile` (intentionally
   **unguarded** — do not wrap them in a route guard).
4. **React 18 stays. pnpm workspace + Vite stay.** No Ionic/Angular CLI eject.
5. **Do not push to `main` or bump versions without approval.** Work on
   `feat/dual-app-epic-*` branches.

## Verified risks (confirmed against the real code + docs — plan around these)

**Risk 1 — Router is v5, your apps are v6 (HIGH).** `@ionic/react-router` (v8.x)
peer-depends on `react-router@^5`. Both apps use v6 (`Routes`, `element=`,
`Navigate`, `useNavigate`, `useSearchParams`). Adopting it means, per app:
`useNavigate`→`useHistory().push` (11 pages + 4 components in customer),
`useSearchParams`→`new URLSearchParams(useLocation().search)` (5 pages:
VerifyEmail, BookAppointment, MyAppointments, ResetPassword, MyWaitingList),
`<Navigate>`→`<Redirect>` (routes + `ProtectedRoute`), `<Routes>`→`<Switch>` in
`IonRouterOutlet`. Watch for a duplicate react-router copy in the workspace
(context errors) — confirmed no shared package imports react-router, so apps can
migrate independently. **Mitigation: the Phase-2 adapter** shrinks the atomic
swap to one reviewable outlet rewrite.

**Risk 2 — Token bridge is not a 1:1 alias (HIGH).** Your *primary* CTA is
**black** (`--ink #040505`); orange `#f03e16` is an accent, and white-on-orange
fails AA. Ionic's color contract needs RGB triplets and contrast colors that
hex can't be aliased into. Build a thin bridge (see below).

**Risk 3 — FullCalendar + Google Maps break inside `IonContent` (HIGH).**
0-width blank render when a page mounts hidden in Ionic's kept-alive stack (fix:
`getApi().updateSize()` in `useIonViewDidEnter`); nested-scroll ownership
(pick ONE scroller per view); 350ms long-press drag vs iOS swipe-back gesture
(disable `swipeBackEnabled` on the calendar page); preserve the existing
`events` `useMemo` (per-keystroke reprocessing froze the dashboard — native
WebViews are slower). The dashboard already ships a scroll-to-top FAB workaround.

## Backend dependencies (OUT OF SCOPE to build here, but native is DEAD without them — start day one)

1. **CORS allowlist.** `api-client` uses `withCredentials: true`, so the API
   cannot send `Access-Control-Allow-Origin: *`. Add `capacitor://localhost`,
   `http://localhost`, `https://localhost` to the credentialed CORS allowlist
   (`CLIENT_URL`) or **every** native API call fails preflight.
2. **Native push token endpoint.** `/push/subscribe` accepts a web
   `PushSubscription` (VAPID). `@capacitor/push-notifications` yields an opaque
   APNs/FCM token; the API needs a token store + APNs/FCM send path. Also: iOS
   Push entitlement + APNs, Android FCM `google-services.json`.

Also register the native OAuth custom-scheme redirect URI on the API
(`AuthCallBack.jsx` reads `?code=`).

## The token bridge (author once, ideally in `packages/design-tokens`)

Map the full `--ion-*` contract onto existing tokens, in `:root` AND
`body.dark-mode`; wire `ThemeContext` to also toggle `.ion-palette-dark`:
- `--ion-color-primary: var(--gold)` **with** `--ion-color-primary-rgb: 240,62,22`
  and `--ion-color-primary-contrast: #040505` (NOT Ionic's default white).
- `--ion-color-dark: var(--ink)` (contrast `#e6e8e7`) — the real black CTA.
- `--ion-background-color: var(--off-white)`;
  `--ion-item/card/toolbar/tab-bar-background: var(--card-bg)` (#fff) to keep
  white-cards-on-gray.
- `--ion-font-family: var(--font-body)` + an `IonTitle`/`IonCardTitle` override
  to `var(--font-display)`.
- success/warning/danger/secondary quartets. Do NOT import Ionic's dark palette.

## Phased plan — each phase independently web-shippable

### Phase 0 — Spike & go/no-go (throwaway, ~2 weeks)
Prove the four project-killers on a real iOS simulator + Android emulator + web
BEFORE migrating any production page: (a) toolchain coexistence + a single
react-router copy after the v6→v5 downgrade under pnpm; (b) the token bridge
renders `IonButton`/`IonToggle`/`IonCard`/`IonTabBar` on-brand in light + dark;
(c) a native WebView authenticates against the API (needs the CORS ask — start
it now); (d) FullCalendar survives `IonContent` via `updateSize()`. Also **kick
off both backend dependencies.** Exit with a written go/no-go.

### Phase 1 — Web-invisible foundations
Add `@ionic/react`, `@ionic/react-router`, `@capacitor/core`, `@capacitor/cli`
to both apps; regenerate + commit `pnpm-lock.yaml` (CI is `--frozen-lockfile`);
add Capacitor native install-script packages to `onlyBuiltDependencies` in
`pnpm-workspace.yaml`; author the token bridge (unimported); add `ios/` + `android/`
to `.dockerignore` so the web Docker context doesn't bloat. Both web builds stay
byte-identical.

### Phase 2 — Routing adapter on v6 (pure refactor, per app)
Create `src/routing/` adapters — `useNav()` over `useNavigate`, `useQueryParams()`
over `useSearchParams`, `<AppRedirect replace>` over `<Navigate>` — still backed
by v6. Migrate all call sites in small, behavior-preserving PRs validated by
existing Playwright. This shrinks the eventual atomic swap to one outlet rewrite.

### Phase 3 — Customer shell flip (atomic v5 swap, web-first)
Lower-risk app first (no calendar/maps). Bump to `@ionic/react-router`; rewrite
`App.jsx` to `IonReactRouter` + `IonRouterOutlet` + `<Switch>`; re-point the
Phase-2 adapter internals to v5 (`useHistory`, `<Redirect>`); wrap pages in
`IonPage`/`IonContent`; import Ionic CSS + the token bridge. Build `IonTabs`
(Home / Bookings / Profile + a non-route "Suggest" tab presenting an `IonModal`);
keep `book-appointment`, `providers/:id`, `b/:slug` OUTSIDE the tabs outlet as
full-screen pushed pages (tab bar hidden, matching today's `hideBottomNav`).
Move window-scroll UX into `ion-content` (Home hero-fade → `onIonScroll`;
IntersectionObserver infinite-scroll → `IonInfiniteScroll`; scroll reset →
`IonContent.scrollToTop()` in `ionViewWillEnter`); remove the
`<div key={location.pathname}>` force-remount and the `--safe-top` paddingTop.
Migrate modals to `IonModal`, retire `useModalChrome` (double scroll-lock).
Gate `useLiveRefresh` on `useIonViewWillEnter/Leave` (Ionic keeps pages mounted).
**Verify guest booking + `/b/:slug`→book still work after the outlet split.**

### Phase 4 — Business shell flip (reuse the pattern) + heavy widgets
Repeat Phase 3 for business. Preserve the nested `/bkplus-command/insights`
(plan hash or fallback — deep paths 404 under Capacitor's static server on
cold-start). Fix `AdminDashboard.jsx` raw `<a href>` → router nav. Reconcile
FullCalendar (`updateSize()` in `ionViewDidEnter`, scroll ownership, disable
swipe-back, keep the `events` memo, move FAB → `IonFab`) and MapPicker
(defer native CSP/geolocation to Phase 5; leave web unchanged). Cross-app
`window.location` redirect → deep link on native.

### Phase 5 — Capacitor native shells (both apps, platform-gated)
`capacitor.config` per app; bake `VITE_API_URL=https://api.bookplus.pro` into
native builds (`inferApiBase` falls back to `localhost:5000` in a WebView).
Extract a shared platform module and branch on `Capacitor.isNativePlatform()`:
push fork (native `@capacitor/push-notifications`, web keeps VAPID + `sw.js`);
gate `freshBuild.js` + `AppUpdater.jsx` OFF on native; `@capacitor/app`
(`appUrlOpen` deep links for OAuth `/auth/callback`, `/manage/:token`, `/b/:slug`;
Android hardware back button; `appStateChange`); `@capacitor/splash-screen`
(`launchAutoHide:false` + `hide()` reconciled with `main.jsx`'s 650/8000ms
timers); `@capacitor/status-bar` on the dark toggle; re-gate the `--safe-top`
50px floor onto a Capacitor body class. MapPicker native CSP allowlist +
`@capacitor/geolocation`. Web build + Docker→SSH deploy stay 100% unchanged.

### Phase 6 — Native CI + store release + hardening
New **macOS-runner** workflow for iOS (Xcode, signing, provisioning, Fastlane) —
ubuntu can't build IPAs — + Android SDK/keystore; `cap sync` after `vite build`;
store submission as a track parallel to the untouched web pipeline. Native assets
via `@capacitor/assets`. Fold `CFBundleShortVersionString`/`versionCode` into the
dual-`package.json` + `vX.Y.Z` tag rule. Add native smoke coverage
(emulator/Maestro) — Playwright exercises only web. Final adaptive-mode QA
(2 apps × 2 platforms × light/dark). Confirm the CORS allowlist + push token
path are live.

## Effort
~4–6 months solo, ~3–4 months with two engineers — **gated on the two backend
dependencies landing on time.** The web/PWA track (Phases 1–4) can ship
independently; only native release (Phases 5–6) stalls if the backend slips.

## Acceptance criteria
- [ ] Every existing customer + business route resolves; guest checkout intact.
- [ ] All brand color/type/spacing traces to `design-tokens`; zero hardcoded brand
      hex in components; Ionic defaults overridden via the bridge (incl. AA).
- [ ] Auth + JWT refresh, push, splash, safe-area, fresh-build reload all work
      (web AND native, correctly platform-gated).
- [ ] FullCalendar + Maps function on device inside `IonContent` (no blank render,
      no double scrollbars, drag/resize not stolen by swipe-back).
- [ ] `pnpm install --frozen-lockfile`, both `vite build`s, and `cap sync` clean.
- [ ] Both apps build as iOS + Android; web Docker→SSH pipeline unchanged.
- [ ] Bundle-size delta measured and recorded.
- [ ] Each PR independently shippable and CI-green.

## Explicitly out of scope / do NOT do
- Do not rewrite `apps/api` beyond coordinating the two named dependencies.
- Do not push to `main` or bump versions without approval.
- Do not replace the design-token system with Ionic theming — bridge onto it.
- Do not rip out FullCalendar or Google Maps for Ionic equivalents.
- Do not guard `/book-appointment` or `/complete-profile` (guest checkout).
- Do not do a single big-bang PR; ship phase by phase.

## First step
Do **Phase 0 only**: stand up the throwaway spike proving the four killers on
simulator/emulator/web, open the two backend coordination tickets, and write the
go/no-go with a bundle-size delta and any theming blockers. Stop and summarize
for review before touching production pages.
