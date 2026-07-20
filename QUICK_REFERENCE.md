# Quick reference

## Dev servers

| What | Command (from repo root) | URL |
|------|--------------------------|-----|
| API | `cd apps/api && npm run dev` (or `pnpm api:dev`) | http://localhost:5050 |
| Customer app | `pnpm customer:dev` | http://localhost:3002 |
| Business app | `pnpm business:dev` | http://localhost:3003 |

Ports 3000/3001/5000 are taken by other stacks on this machine.
`start.bat` → option 3 starts the API + customer app (run `pnpm business:dev`
separately for the business app).

## Install

```bash
pnpm install            # repo root — apps + shared packages/*
cd apps/api && npm ci   # API is npm-managed (own package-lock.json)
```

## Tests

```bash
cd apps/api && npm test                       # API suite (Jest, in-memory MongoDB)
pnpm --filter @bookplus/customer test:e2e     # customer Playwright e2e — boots its own API
pnpm --filter @bookplus/business test:e2e     # business Playwright e2e — boots API + both apps
```

## Builds

```bash
pnpm --filter @bookplus/customer build
pnpm --filter @bookplus/business build
```

## Docker

```bash
docker compose up -d    # mongodb · server · customer · business · nginx · certbot · backup
```

## Production URLs

| Surface | URL |
|---------|-----|
| Customer marketplace | https://www.bookplus.pro (apex + app.bookplus.pro 301 here) |
| Business app | https://business.bookplus.pro |
| API | https://api.bookplus.pro |
| API health | https://api.bookplus.pro/api/health |

## Key facts

- Admin console is role-gated **inside the business app** at `/bkplus-command`
  (+ `/insights`) — admins log into business.bookplus.pro.
- Push to `main` = deploy (CI builds images → Docker Hub → SSH auto-deploy).
  **Never push to main without explicit approval.**
- Version bump = `apps/api` + `apps/customer` + `apps/business` package.json
  and an annotated `vX.Y.Z` tag.
- Local env: apps take `VITE_API_URL` (API **origin** only, e.g.
  `http://localhost:5050` — the api-client appends `/api`); the API's env
  lives in `apps/api/.env` (see `apps/api/.env.example`).
