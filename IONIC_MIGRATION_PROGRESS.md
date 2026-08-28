# Ionic Migration — Progress & Resume Point

> **Where we are and where to continue.** Companion to `IONIC_MIGRATION_PROMPT.md`
> (the full engineering brief). This file tracks status; the brief holds the plan.

- **Last updated:** 2026-07-15
- **Branch:** `claude/ionic-framework-overview-l3vwp9`
- **Tracking:** epic [#68](https://github.com/ErastusM/Booking-Application/issues/68)
  with phases #69–#74 + blockers #66/#67 as sub-issues.
- **Overall status:** 🟢 **Phases 1 & 2 built (on branches); Phase 0 is 3/4 proven
  on the web — no Mac needed.** Backend blockers #66/#67 are done as held PRs.
  The only remaining go/no-go input is killer (c): native WebView auth + Google
  OAuth, which needs a Mac/device. **Nothing merged; nothing deployed; `main`
  untouched.** Branches: `feat/ionic-cors-origins` (#66), `feat/ionic-push-tokens`
  (#67), `feat/ionic-p1-foundations` (P1), `feat/ionic-p2-routing-adapter` (P2),
  `spike/ionic-phase0-web` (killers a/b/d).

---

## TL;DR — continue from here

**Next action: finish Phase 0 on a local machine** — the parts that need an
iOS simulator / Android emulator. The device-independent Phase 0/1 deliverables
are already committed: the token→Ionic bridge (`packages/design-tokens/ionic-bridge.css`)
and the two backend tickets (`docs/ionic-native-backend-dependencies.md`).
Nothing in `apps/` has been touched. See [Next steps](#next-steps).

Both open decisions are now **confirmed** (full Ionic router v5 + adaptive mode)
— see [Decisions](#decisions--confirmed-2026-07-14).

---

## What's been done

| # | Item | Status |
|---|------|--------|
| 1 | Framework overview + React 18 vs Ionic comparison | ✅ Delivered (chat) |
| 2 | Decision to proceed with Ionic React + Capacitor | ✅ Confirmed by user |
| 3 | Subsystem analysis of the real repo (routing, tokens, heavy widgets, native behaviors, infra) | ✅ Done |
| 4 | Adversarial verification of top technical risks | ✅ Done (3 top risks confirmed HIGH) |
| 5 | Full engineering brief → `IONIC_MIGRATION_PROMPT.md` | ✅ Committed |
| 6 | Token→Ionic bridge → `packages/design-tokens/ionic-bridge.css` (+ package export) | ✅ Committed (unimported) |
| 7 | Backend dependency tickets → drafted in `docs/…` + filed as issues [#66](https://github.com/ErastusM/Booking-Application/issues/66) (CORS, P0) & [#67](https://github.com/ErastusM/Booking-Application/issues/67) (push, P1) | ✅ Filed |
| 8 | GitHub issue breakdown: epic [#68](https://github.com/ErastusM/Booking-Application/issues/68) + phases [#69–#74](https://github.com/ErastusM/Booking-Application/issues/68) as sub-issues | ✅ Created |
| 9 | Both open decisions locked (router = full Ionic v5; mode = adaptive) | ✅ Confirmed 2026-07-14 |
| 10 | PR [#75](https://github.com/ErastusM/Booking-Application/pull/75) opened (docs + token bridge → `main`) | ✅ Open · CI green · monitored |
| 11 | Phase 0 device proofs (deps + router downgrade, on-device auth, FullCalendar) | ⬜ Needs local Xcode/Android Studio |

### Commits on this branch (newest first)
```
d4ac174  docs: lock router (full Ionic v5) + platform mode (adaptive) decisions
51b9e12  docs: link epic #68 + phase issues (#69-#74) in progress tracker
32b93cc  docs: link filed backend dependency issues (#66 CORS, #67 push)
f887c41  feat(design-tokens): add token->Ionic bridge + draft native backend tickets
d730b26  docs: add migration progress + resume-point tracker
0fe5eb5  docs: rewrite Ionic migration brief with verified risks and phased plan
72b222c  docs: pin adaptive platform mode and both-app/both-platform scope
bb154d6  docs: add Ionic React + Capacitor migration prompt
```
Changes so far are **additive and inert**: a new unimported CSS file + a
package export entry + docs. No changes to `apps/*`; both web builds are
unaffected.

### PR & monitoring
- **PR [#75](https://github.com/ErastusM/Booking-Application/pull/75)** (`claude/ionic-framework-overview-l3vwp9` → `main`): **open**,
  `mergeable_state: clean`, CI **green** (`test` passing; `build-and-push` +
  `deploy` correctly skipped — they only run on `main`), **0 review comments**.
  Ready to merge on sign-off. Merging to `main` triggers the deploy pipeline,
  but no app code changed so it redeploys identical web apps.
- **Watch:** this session is subscribed to PR #75 activity (auto-responds to CI
  failures / review comments until merged or closed). ⚠️ The proactive hourly
  re-check could not be re-armed — the scheduling server (`Claude_Code_Remote`)
  was disconnected; webhook-driven events still wake the session.

---

## Key findings (verified against the code + Ionic/Capacitor docs)

1. **Router is the crux.** `@ionic/react-router` uses React Router **v5**; both
   apps are on **v6**. Adopting it = a down-conversion across every nav call
   (`useNavigate`→`useHistory`, `useSearchParams`→`URLSearchParams`,
   `Navigate`→`Redirect`). De-risked via the Phase-2 routing adapter.
2. **Two out-of-scope backend blockers make native dead-on-arrival:**
   credentialed CORS for `capacitor://` origins (axios uses
   `withCredentials: true` → no wildcard) and a native APNs/FCM push token
   endpoint (`/push/subscribe` is web-push/VAPID today). **Must start day one.**
3. **Token bridge is not a 1:1 alias** — primary CTA is black `#040505`, orange
   is an accent, white-on-orange fails AA. Needs RGB triplets + explicit contrast.
4. **FullCalendar + Google Maps need deliberate `IonContent` integration**
   (0-width blank render, scroll ownership, long-press vs iOS swipe-back).

Full detail lives in `IONIC_MIGRATION_PROMPT.md` → "Verified risks" and
"Backend dependencies".

---

## Decisions (✅ confirmed 2026-07-14)

| Decision | Confirmed choice |
|----------|------------------|
| **Router** | Adopt `@ionic/react-router` (full Ionic, v5 down-conversion) |
| **Platform mode** | Adaptive (iOS=Cupertino, Android=Material) — extra visual QA budgeted in Phase 6 |

---

## Issue tracker

Epic [#68](https://github.com/ErastusM/Booking-Application/issues/68) — sub-issues:

| Issue | Scope |
|-------|-------|
| [#66](https://github.com/ErastusM/Booking-Application/issues/66) | Backend: credentialed CORS for `capacitor://` origins (P0) |
| [#67](https://github.com/ErastusM/Booking-Application/issues/67) | Backend: APNs/FCM native push token endpoint (P1) |
| [#69](https://github.com/ErastusM/Booking-Application/issues/69) | Phase 1 — Web-invisible foundations |
| [#70](https://github.com/ErastusM/Booking-Application/issues/70) | Phase 2 — Routing adapter on v6 |
| [#71](https://github.com/ErastusM/Booking-Application/issues/71) | Phase 3 — Customer shell flip |
| [#72](https://github.com/ErastusM/Booking-Application/issues/72) | Phase 4 — Business shell flip + FullCalendar/Maps |
| [#73](https://github.com/ErastusM/Booking-Application/issues/73) | Phase 5 — Capacitor native shells |
| [#74](https://github.com/ErastusM/Booking-Application/issues/74) | Phase 6 — Native CI + store release |

## Phase checklist

- 🟢 **Phase 0** — Spike & go/no-go. Token bridge ✅ authored; backend tickets ✅
  filed as held PRs (#66 → PR #76, #67 → PR #77). **3 of 4 killers proven on the
  web (no Mac), branch `spike/ionic-phase0-web`:**
  - **(a) ✅ single react-router copy** — customer downgraded to
    `react-router-dom@5.3.4` resolves ONE copy that satisfies `@ionic/react-router@8`'s
    `react-router ^5.0.1` peer (reverted after proving).
  - **(b) ✅ token bridge on-brand** — computed styles: `color=primary` →
    rgb(240,62,22) orange, `color=dark` (real CTA) → rgb(4,5,5) black, IonCard →
    white; dark mode flips bg→rgb(10,10,11)/text→rgb(230,232,231) via `body.dark-mode`.
  - **(d) ✅ FullCalendar in `IonContent`** — `getApi().updateSize()` after mount →
    1389px height (not 0), 7 day columns, 96 time-slots, event rendered.
  - **Bundle delta:** app-wide Ionic React adds **~178 KB gzip** (measured as the
    lazy spike chunk; the main bundle was unaffected while unimported).
  - **(c) ⬜ native WebView auth + Google OAuth** — the ONLY remaining killer;
    needs a Mac/device. #66 (its CORS prereq) is done.
- ✅ **Phase 1** — Web-invisible foundations (deps, lockfile, `.dockerignore`) —
  `feat/ionic-p1-foundations`; both web builds **byte-identical** (deps unimported).
- ✅ **Phase 2** — Routing adapter on v6 (`useNav`/`useQueryParams`/`AppRedirect`
  over 28 call sites) — `feat/ionic-p2-routing-adapter`; e2e identical before/after.
- 🟢 **Phase 3** — Customer shell flip (atomic v5 swap, web-first) — **READY**;
  the router swap + bridge + FullCalendar are pre-proven. Gated only on killer (c).
- ⬜ **Phase 4** — Business shell flip + FullCalendar/Maps.
- ⬜ **Phase 5** — Capacitor native shells (both apps, platform-gated). *Mac.*
- ⬜ **Phase 6** — Native CI + store release + hardening. *Mac + store accounts.*

**Effort:** ~4–6 months solo / ~3–4 with two engineers, gated on the backend
dependencies. Web/PWA track (Phases 1–4) can ship independently of native.

---

## Next steps

1. ~~Confirm the two open decisions~~ ✅ done — full Ionic router (v5) + adaptive mode.
2. ~~File + build the backend blockers~~ ✅ done as **held PRs**: #66 → PR #76
   (`feat/ionic-cors-origins`, +7 tests), #67 → PR #77 (`feat/ionic-push-tokens`,
   +6 tests, backward-compatible, no index migration). Both additive/web-safe.
   **Deploy them when ready** (they can ship to the live API independently).
3. ~~Web-testable Phase 0 killers~~ ✅ done (no Mac) — killers (a), (b), (d) proven,
   see the Phase-0 block above. Only **(c) native WebView auth + Google OAuth**
   remains — the ONE thing needing a **Mac / device**:
   - `npx cap add ios/android`, open the shell, sign in with **email/password**,
     let the access token expire → confirm the **localStorage body-token refresh**
     works (the `bp_rt` SSO cookie will NOT attach at `capacitor://localhost`).
   - Attempt **Google sign-in in the WebView** — Google blocks its consent screen
     in embedded WebViews (`disallowed_useragent`), so this likely needs a native
     flow (Capacitor Google-Auth plugin / ASWebAuthenticationSession + Custom Tabs
     with a custom-scheme redirect). **Treat OAuth feasibility as a go/no-go input.**
   - Write the final go/no-go (the web half is already recorded above).
4. On **GO**, Phase 3 (customer shell flip, web-first) is ready — the router swap,
   bridge, and FullCalendar-in-IonContent are all pre-proven on the web.

### Already delivered / on branches (nothing merged, `main` untouched)
- `packages/design-tokens/ionic-bridge.css` — the full `--ion-*` mapping
  (primary=orange accent, dark=black CTA, AA-safe contrast, white-cards-on-gray,
  light + dark). **Proven on the web** (see killer (b)).
- **#66** CORS + **#67** push-token PRs (held); **P1** foundations + **P2** routing
  adapter branches; **`spike/ionic-phase0-web`** (reproducible killer proofs).
- `docs/ionic-native-backend-dependencies.md` — the CORS + push tickets.
