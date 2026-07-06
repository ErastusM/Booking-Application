# Bookplus Booking App — Project Context

## What this is
Appointment-booking platform being restructured into a dual-app
product (customer marketplace + business management app, one backend).
**Read `DUAL_APP_ARCHITECTURE.md` (why/what) and `DUAL_APP_SPEC.md` (how,
epics, acceptance criteria) before working on that initiative.**

## Stack
- Backend: Node/Express, MongoDB/Mongoose, JWT auth (access + rotating refresh,
  `tokenVersion`) — lives in `apps/api` (npm-managed until Epic 1)
- Frontends: React 18 + Vite — `apps/customer` (marketplace, :3002 local,
  app.bookplus.pro + www) and `apps/business` (provider/staff/admin suite,
  :3003 local, business.bookplus.pro). The legacy CRA client is retired.
- Shared packages (pnpm workspace): `packages/design-tokens` (tokens.css +
  tailwind preset — single source of truth for color/type/spacing),
  `packages/api-client` (axios instance + refresh interceptor + domain
  services, TypeScript), `packages/ui` (shared components), `packages/config`
  (shared tsconfig)
- Fonts: Plus Jakarta Sans only, via `var(--font-display)` / `var(--font-body)`
- Colors: orange `#f03e16`, black `#040505`, white `#e6e8e7`

## Commands
- Install: `pnpm install` (root; covers apps + packages), `npm ci` in `apps/api`
- API dev: `npm run dev` in `apps/api` (or `pnpm api:dev` from root)
- App dev: `pnpm customer:dev` / `pnpm business:dev` — ports 3002/3003, API 5050
  (3000/3001/5000 are taken by other stacks on this machine)
- API tests: `npm test` in `apps/api` (jest, in-memory Mongo)
- E2E: `pnpm --filter @bookplus/customer test:e2e` (playwright; boots its own API)
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
- Admin panel: role-gated inside the business app at `/bkplus-command`
  (+ `/insights`) — admins log into business.bookplus.pro
