# Prompt: Migrate Bookplus to Ionic React + Capacitor

> Hand this prompt to a coding agent (or use it as the engineering brief) to
> transform the Bookplus web apps into cross-platform Ionic React + Capacitor
> apps that ship to iOS, Android, and the web from one codebase — **without
> throwing away the existing design system.**

---

## Role & context

You are a senior front-end engineer executing a framework migration on the
**Bookplus** appointment-booking platform. Read `CLAUDE.md`,
`DUAL_APP_ARCHITECTURE.md`, and `DUAL_APP_SPEC.md` before you start.

The repo is a **pnpm workspace** with two React 18 + Vite front-ends and one
Node/Express API:

- `apps/customer` — marketplace (`@bookplus/customer`, port 3002, React 18 + Vite,
  React Router v6, lazy-loaded pages under `src/pages`, components under
  `src/components`). This is a PWA with a boot splash, `--safe-top` safe-area
  handling, push notifications, and a "reload onto fresh build" mechanism.
- `apps/business` — provider/staff/admin suite (`@bookplus/business`, port 3003,
  same stack + FullCalendar + Google Maps).
- `apps/api` — Node/Express/MongoDB (npm-managed). **Out of scope — do not touch.**

Shared packages (must keep working):
- `packages/design-tokens` — `tokens.css` (CSS custom properties: `--gold`
  `#f03e16`, `--charcoal` `#040505`, `--off-white` `#e6e8e7`, radii, spacing,
  motion, shadows) + a Tailwind preset. **Single source of truth for styling.**
- `packages/api-client` — axios + JWT refresh interceptor + domain services.
- `packages/ui` — shared components.
- `packages/config` — shared tsconfig.

Fonts are self-hosted variable fonts via `@fontsource-variable` — Plus Jakarta
Sans (display) and Inter (body). Always reference `var(--font-display)` /
`var(--font-body)`; never hardcode family names.

## Objective

Adopt **Ionic React** (`@ionic/react`, `@ionic/react-router`) for UI/navigation
and **Capacitor** for native packaging, so both apps run as native iOS/Android
apps and installable PWAs from the same React 18 codebase — while the Bookplus
brand and design tokens remain the source of truth for all visual styling.

**Both apps ship on both platforms.** `apps/customer` AND `apps/business` must
each build and run as native **iOS** and **Android** apps (plus web/PWA). The
customer app is migrated first only to prove the theming/routing approach; the
business app is an equal, required deliverable — not optional follow-up.

**Platform rendering: adaptive.** Call `setupIonicReact()` with the default
adaptive mode so Ionic renders iOS conventions (Cupertino) on Apple devices and
Material Design on Android automatically. The Bookplus brand — orange/black/white
and Plus Jakarta Sans + Inter — stays identical across both platforms via the
token bridge; only OS-level conventions (switches, back-nav, spacing) differ.
Do NOT force a single mode.

## Hard constraints (do not violate)

1. **Design tokens win over Ionic defaults.** Bridge, don't replace. Map the
   values in `packages/design-tokens/tokens.css` onto Ionic's CSS variables
   (`--ion-color-primary`, `--ion-background-color`, `--ion-font-family`, the
   `--ion-color-*` step ramps, etc.) in one central theme file per app. Never
   hardcode a brand color inside a component — it must trace back to a token.
2. **Keep both apps shippable at every commit.** No "big bang" rewrite. Migrate
   incrementally behind a working build; each PR must build and run.
3. **Preserve existing behavior:** auth + JWT refresh, push notifications, the
   boot splash, safe-area (`--safe-top`) handling, fresh-build reload, SEO,
   FullCalendar and Google Maps in business, and all current routes.
4. **React 18 stays.** Ionic React runs on it — do not downgrade or fork React.
5. **pnpm workspace + Vite stay.** Ionic React supports Vite; keep the Vite
   toolchain and `workspace:*` package links. Do not introduce the Angular CLI.
6. **API untouched.** No changes to `apps/api` contracts.
7. **Branch/PR discipline per `CLAUDE.md`:** work on a `feat/*` branch, never
   push to `main` (main is the deploy trigger). Keep customer + business
   `package.json` versions in sync when bumping.

## Approach — phased, each phase independently shippable

### Phase 0 — Spike & decision record (no app changes)
- Add `@ionic/react`, `@ionic/react-router`, `@ionic/core`, and `@capacitor/core`
  + `@capacitor/cli` to `apps/customer` only, behind a throwaway spike route.
- Prove the token→Ionic-variable bridge on **one** screen (e.g. an `ion-page`
  wrapper around the existing Home content) rendering in Bookplus brand colors
  and fonts on both iOS and Android modes.
- Write `docs/IONIC_MIGRATION.md` capturing: the token→`--ion-*` mapping table,
  which routes become `IonRouterOutlet` + `IonTabs`, bundle-size delta, and any
  component that resists theming. Get sign-off before Phase 1.

### Phase 1 — Customer app shell
- Wrap the app in `IonApp` + `setupIonicReact()` in **adaptive mode** (the
  default — do not pass a fixed `mode`), so iOS renders Cupertino and Android
  renders Material automatically while the brand stays consistent via the bridge.
- Replace the React Router `BrowserRouter`/`Routes` tree in `apps/customer/src/App.jsx`
  with `IonReactRouter` + `IonRouterOutlet`, preserving **every** current path
  and the lazy-loading. Convert bottom navigation to `IonTabs`; keep the
  `FooterGate` behavior (footer only on `/` and `/about`).
- Fold the existing boot splash, `--safe-top`, and fresh-build reload logic into
  the Ionic shell (Ionic has safe-area handling — reconcile, don't duplicate).
- Create `apps/customer/src/theme/ionic-brand.css` mapping tokens → Ion vars and
  import it once in `main.jsx` after `tokens.css`.

### Phase 2 — Customer screens, highest-value first
Migrate page-by-page to Ionic components where they add real native value; leave
purely-content pages on existing markup wrapped in `IonPage`/`IonContent`:
- `MyAppointments` → `IonList` + `ion-refresher` (pull-to-refresh) +
  `ion-item-sliding` (swipe to cancel/reschedule).
- `BookAppointment` → `IonDatetime` for date/time selection; `IonModal` /
  `IonActionSheet` for confirmations (replace `RescheduleModal`,
  `IntakeFormModal`, `ReviewModal`, `WalletTopUpModal` where it improves UX).
- `Home` / `ProviderProfile*` → `IonSearchbar`, `IonInfiniteScroll` for the feed.
- Keep `Toast`, `StatusOverlay` semantics (map to `IonToast`/`IonLoading` only if
  cleaner). Verify every migrated screen against its `DUAL_APP_SPEC.md` criteria.

### Phase 3 — Capacitor native layer (customer)
- `npx cap init`, add `@capacitor/ios` and `@capacitor/android`; point
  `webDir` at the Vite build output.
- Wire native equivalents of existing web features via plugins:
  `@capacitor/push-notifications` (reconcile with current web push +
  `EnablePushBanner`/`PushToggle`), `@capacitor/app` (back button, deep links),
  `@capacitor/splash-screen` (align with the current splash), `@capacitor/status-bar`.
- Add `pnpm --filter @bookplus/customer cap:sync` / `cap:ios` / `cap:android`
  scripts. Document local build prerequisites (Xcode/Android Studio) in
  `docs/IONIC_MIGRATION.md`.

### Phase 4 — Business app
- Repeat Phases 1–3 for `apps/business`. Extra care for the two heavy widgets:
  **keep FullCalendar and Google Maps as-is inside `IonContent`** unless an
  Ionic-native replacement is clearly better — verify scroll/gesture behavior
  inside `IonContent` (nested scroll containers are a known friction point).
- Preserve the `/bkplus-command` + `/insights` admin role-gating.

### Phase 5 — Shared packages & cleanup
- If Ionic wrappers are reused across both apps, lift them into `packages/ui`.
- Extend `packages/design-tokens` with the canonical token→`--ion-*` bridge so
  both apps import one source (don't duplicate the mapping per app).
- Update Playwright e2e (`apps/*/e2e`) for the new DOM; add at least a smoke test
  per app. Update `README.md`, `SETUP.md`, `QUICK_REFERENCE.md`, `ARCHITECTURE.md`.

## Deliverables
- Both apps building and running on web (`pnpm customer:dev` / `pnpm business:dev`)
  and buildable as iOS + Android via Capacitor.
- `docs/IONIC_MIGRATION.md`: token bridge table, routing map, plugin list, native
  build steps, and a list of anything deferred.
- Green e2e smoke tests per app.
- Brand fidelity: a reviewer comparing before/after sees the same Bookplus look
  (orange/black/white, Plus Jakarta Sans + Inter), now with native transitions.

## Acceptance criteria
- [ ] Every existing customer + business route resolves (no dead links).
- [ ] All brand color/type/spacing traces to `design-tokens` — zero hardcoded
      hex brand values in components; Ionic defaults are overridden via the bridge.
- [ ] Auth + JWT refresh, push, splash, safe-area, and fresh-build reload all work.
- [ ] FullCalendar + Google Maps still function in business inside `IonContent`.
- [ ] `pnpm install`, both `vite build`s, and `cap sync` succeed clean.
- [ ] Bundle-size delta is measured and recorded, not ignored.
- [ ] Each PR is independently shippable and passes CI.

## Explicitly out of scope / do NOT do
- Do not modify `apps/api` or any API contract.
- Do not push to `main` or bump versions without approval.
- Do not replace the design-token system with Ionic's theming — bridge onto it.
- Do not rip out FullCalendar or Google Maps just to use Ionic equivalents.
- Do not do a single massive rewrite PR; ship phase by phase.

## First step
Start with **Phase 0 only**: add the dependencies to `apps/customer`, build the
one-screen token→Ionic-variable spike, write the mapping table into
`docs/IONIC_MIGRATION.md`, and report the bundle-size delta + any theming
blockers before touching routing or other screens. Stop and summarize for review
at the end of Phase 0.
