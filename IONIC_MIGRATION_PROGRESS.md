# Ionic Migration — Progress & Resume Point

> **Where we are and where to continue.** Companion to `IONIC_MIGRATION_PROMPT.md`
> (the full engineering brief). This file tracks status; the brief holds the plan.

- **Last updated:** 2026-07-14
- **Branch:** `claude/ionic-framework-overview-l3vwp9`
- **Overall status:** 🟡 **Planning complete — no application code changed yet.**
  The migration has been scoped, risk-verified against the real codebase, and
  written up. Execution (Phase 0) has **not** started.

---

## TL;DR — continue from here

**Next action: Phase 0 (throwaway spike + go/no-go).** Nothing in `apps/` has
been touched. Before writing any production code, stand up the spike that proves
the four project-killers and open the two backend tickets. See
[Next steps](#next-steps).

Two decisions are set as defaults and can still be flipped (see
[Open decisions](#open-decisions)) — confirm or change them before Phase 3.

---

## What's been done

| # | Item | Status |
|---|------|--------|
| 1 | Framework overview + React 18 vs Ionic comparison | ✅ Delivered (chat) |
| 2 | Decision to proceed with Ionic React + Capacitor | ✅ Confirmed by user |
| 3 | Subsystem analysis of the real repo (routing, tokens, heavy widgets, native behaviors, infra) | ✅ Done |
| 4 | Adversarial verification of top technical risks | ✅ Done (3 top risks confirmed HIGH) |
| 5 | Full engineering brief → `IONIC_MIGRATION_PROMPT.md` | ✅ Committed |
| 6 | Phase 0 spike | ⬜ Not started |
| 7 | Backend dependency tickets (CORS, push token) | ⬜ Not raised |

### Commits on this branch
```
0fe5eb5  docs: rewrite Ionic migration brief with verified risks and phased plan
72b222c  docs: pin adaptive platform mode and both-app/both-platform scope
bb154d6  docs: add Ionic React + Capacitor migration prompt
```
No changes to `apps/customer`, `apps/business`, `apps/api`, or `packages/*`.

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

## Open decisions

Both are set to defaults in the brief. **Confirm or flip before Phase 3.**

| Decision | Current default | Alternative |
|----------|-----------------|-------------|
| **Router** | Adopt `@ionic/react-router` (full Ionic, v5 down-conversion) | Keep React Router v6; use Ionic UI + Capacitor only |
| **Platform mode** | Adaptive (iOS=Cupertino, Android=Material) | Force one mode (e.g. `mode='ios'`) for brand consistency + simpler QA |

---

## Phase checklist

- ⬜ **Phase 0** — Spike & go/no-go (throwaway): prove the 4 killers on
  simulator/emulator/web; open the 2 backend tickets; write go/no-go.
- ⬜ **Phase 1** — Web-invisible foundations (deps, lockfile, token bridge,
  `.dockerignore`), builds byte-identical.
- ⬜ **Phase 2** — Routing adapter on v6 (pure refactor, per app).
- ⬜ **Phase 3** — Customer shell flip (atomic v5 swap, web-first).
- ⬜ **Phase 4** — Business shell flip + FullCalendar/Maps.
- ⬜ **Phase 5** — Capacitor native shells (both apps, platform-gated).
- ⬜ **Phase 6** — Native CI + store release + hardening.

**Effort:** ~4–6 months solo / ~3–4 with two engineers, gated on the backend
dependencies. Web/PWA track (Phases 1–4) can ship independently of native.

---

## Next steps

1. **Confirm the two open decisions** (or accept defaults).
2. **Raise the two backend tickets** (CORS allowlist + native push token
   endpoint) — long lead time, native is blocked without them.
3. **Start Phase 0 spike** on a throwaway branch:
   - Add Ionic + Capacitor to `apps/customer`; downgrade react-router to v5;
     confirm pnpm resolves a single copy.
   - Author the token→`--ion-*` bridge; verify on-brand light + dark.
   - Prove a native WebView authenticates against the API (needs CORS ticket).
   - Prove FullCalendar survives `IonContent` via `updateSize()`.
   - Write the go/no-go with a bundle-size delta.
4. **Stop and review** before touching production pages (Phase 1+).
