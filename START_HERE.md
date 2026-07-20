# Start here

Bookplus is a **live, dual-app appointment-booking platform** — one shared
backend, two frontends:

- **Customer marketplace** — `apps/customer` → https://www.bookplus.pro
  (discover providers, book, guest checkout, wallet, waiting list)
- **Business management app** — `apps/business` → https://business.bookplus.pro
  (providers, staff and admins: calendar, services, clients, earnings, team)
- **Shared API** — `apps/api` (Node/Express/MongoDB) → https://api.bookplus.pro

The repo is a pnpm monorepo (`apps/*` + shared `packages/*`); the API is
deliberately npm-managed with its own lockfile. The legacy CRA client is
retired.

## Reading order

1. `README.md` — product overview, stack, setup, highlights, known limitations
2. `CLAUDE.md` / `AGENTS.md` — project conventions, commands, workflow rules
3. `DUAL_APP_ARCHITECTURE.md` (why/what) + `DUAL_APP_SPEC.md` (how — epics,
   acceptance criteria)
4. `DEPLOY_DUAL_APP.md` — deploy topology (images, nginx, DNS, CI/CD)
5. `MONITORING.md` — healthchecks + uptime monitoring

## Run it locally

```bash
pnpm install                  # repo root — apps + shared packages
cd apps/api && npm ci         # API is npm-managed (own lockfile)
cp apps/api/.env.example apps/api/.env   # then fill in secrets — the API
                                         # won't boot without it (see SETUP.md)

cd apps/api && npm run dev    # API on :5050
pnpm customer:dev             # customer app on :3002
pnpm business:dev             # business app on :3003
```

(3000/3001/5000 are taken by other stacks on this machine — Bookplus runs on
3002/3003/5050. Or `start.bat` → option 3 starts the API + customer app; run
`pnpm business:dev` separately.)

## Test

```bash
cd apps/api && npm test                       # Jest + Supertest, in-memory MongoDB
pnpm --filter @bookplus/customer test:e2e     # customer Playwright e2e — boots its own API
pnpm --filter @bookplus/business test:e2e     # business Playwright e2e — boots API + both apps
```

For anything else — commands, URLs, key facts — see `QUICK_REFERENCE.md`.
