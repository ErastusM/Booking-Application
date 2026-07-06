# Bookplus Booking App — Project Context

## What this is
Appointment-booking platform being restructured into a dual-app
product (customer marketplace + business management app, one backend).
**Read `DUAL_APP_ARCHITECTURE.md` (why/what) and `DUAL_APP_SPEC.md` (how,
epics, acceptance criteria) before working on that initiative.**

## Stack
- Backend: Node/Express, MongoDB/Mongoose, JWT auth (access + rotating refresh,
  `tokenVersion`) — lives in `apps/api` (npm-managed until Epic 1)
- Frontend: React 18, React Router v6, CRA — lives in `client`
  (pnpm workspace member; replaced by `apps/customer` + `apps/business` in Epic 1)
- Shared packages (pnpm workspace): `packages/design-tokens` (tokens.css +
  tailwind preset — single source of truth for color/type/spacing),
  `packages/api-client` (axios instance + refresh interceptor + domain
  services, TypeScript), `packages/ui` (shared components), `packages/config`
  (shared tsconfig)
- Fonts: Plus Jakarta Sans only, via `var(--font-display)` / `var(--font-body)`
- Colors: orange `#f03e16`, black `#040505`, white `#e6e8e7`

## Commands
- Install: `pnpm install` (root; covers client + packages), `npm ci` in `apps/api`
- API dev: `npm run dev` in `apps/api` (or `pnpm api:dev` from root)
- Client dev: `pnpm client:start` (root) — local ports: client 3001, API 5050
  (3000/5000 are taken by other Docker stacks on this machine)
- API tests: `npm test` in `apps/api` (jest, in-memory Mongo)
- E2E: `pnpm --filter bookplus-client test:e2e` (playwright; boots its own API)
- Or: `start.bat` → option 3 (starts both servers)

## Workflow
- Dual-app restructure work happens on `feat/dual-app-epic-*` branches via PRs.
  **Never push to main without explicit approval** — push to main is the deploy
  trigger (CI builds images → Docker Hub → SSH auto-deploy).
- Keep the app shippable at every commit; verify each spec task against its
  acceptance criteria before moving on.
- Version bump = both `apps/api` + `client` package.json and an annotated
  `vX.Y.Z` tag.

## Design system
- All headings: `fontFamily: 'var(--font-display)'`
- CSS variables come from `@bookplus/design-tokens/tokens.css` — never
  redeclare tokens locally
- Cards: white bg, `border: '1px solid var(--border)'`, `borderRadius: 'var(--radius)'`
- Buttons: `className="btn-primary"` / `className="btn-outline"`
- Known drift: the tailwind preset intentionally freezes pre-monorepo values
  (stale fonts/shadows) — reconcile in Epic 1, not before
