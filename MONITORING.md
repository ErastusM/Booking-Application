# Monitoring & Uptime

How we know Bookplus is up — and how we find out fast when it isn't.

## What exists

### 1. Container health checks (`docker-compose.yml`)
Every long-running service declares a `healthcheck`, so `docker compose ps`
shows `healthy` / `unhealthy` instead of just `running`:

| Service    | Check                                             | "Healthy" means |
|------------|---------------------------------------------------|-----------------|
| `mongodb`  | `mongosh --eval "db.adminCommand('ping')"`        | DB answers      |
| `server`   | `GET localhost:5000/api/health` returns **200**   | App is listening **and** Mongo is connected (returns 503 otherwise) |
| `customer` | `GET localhost:3000/` returns `<500`              | Static SPA is being served |
| `business` | `GET localhost:3000/` returns `<500`              | Static SPA is being served |
| `nginx`    | `GET localhost/healthz` returns 200               | Reverse proxy is up and its config parsed |

Check them on the host:
```bash
docker compose ps                         # STATUS column shows (healthy)/(unhealthy)
docker inspect bookplus-server | jq '.[0].State.Health'   # last 5 probe results
```

The API's `/api/health` is the source of truth for readiness — it reports DB
state, uptime and a timestamp, and the server only binds its port **after**
Mongo connects, so a passing check genuinely means "ready to take traffic".

### 2. Backend error alerting (already in place)
- 5xx responses, unhandled rejections and uncaught exceptions POST to
  `ALERT_WEBHOOK_URL` (Slack/Discord-style), throttled to 5/5 min. No-op if the
  env var is unset. See `apps/api/src/utils/alerts.js`.
- `429` (rate-limit) responses now also alert — a spike means abuse or a client
  bug hammering the API.

### 3. Frontend error capture (added with this change)
Uncaught JS errors, unhandled promise rejections and React render crashes in
**both** apps are POSTed to `POST /api/client-errors`, which logs them and pages
the same webhook (deduplicated, rate-limited). No third-party account needed.

## What you still need to set up (external, one-time)

Container health tells the *host* something is wrong; it can't tell *you* if the
whole box is down. Add an external monitor (UptimeRobot, BetterStack, Pingdom —
all have free tiers):

| Monitor            | URL                                   | Healthy | Interval |
|--------------------|---------------------------------------|---------|----------|
| API readiness      | `https://api.bookplus.pro/api/health` | `200`   | 1–5 min  |
| Customer site      | `https://www.bookplus.pro/`           | `2xx`   | 5 min    |
| Business app       | `https://business.bookplus.pro/`      | `2xx`   | 5 min    |

Point the monitor's alert at the same Slack/Discord channel as `ALERT_WEBHOOK_URL`
(or an email/SMS). Recommended alert rules: status ≠ expected for 2 consecutive
checks, or response time > 3s.

Set `ALERT_WEBHOOK_URL` in the host `.env.production` (and optionally as a GitHub
secret seeded on deploy) so backend + frontend alerts actually deliver.

## Optional hardening (not enabled — deliberate)

`depends_on: { condition: service_healthy }` would make nginx refuse to start
until the backends are healthy, fully preventing "boots but not ready" traffic.
It's left off because a single mis-firing health check would then block the whole
deploy; the app already gates its own readiness (server listens only after DB
connect), and the health **status** above is enough for `docker ps` + external
monitors. Revisit if we move to an orchestrator (Swarm/K8s) that auto-reschedules
on unhealthy.
