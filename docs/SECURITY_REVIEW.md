# Security and engineering review — October 2026

Bookplus checked against two lists: the 30 common "vibe-coding" security
mistakes, and the "who's gonna tell vibe coders about…" engineering list.
Every claim below was checked in the code or config. File references are
relative to the repository root.

Status key: **OK** (in place) · **Fixed** (fixed in the PR that added this
file) · **You** (needs the owner, outside the code) · **Later** (worth doing,
not urgent) · **N/A** (doesn't apply at this size).

## Fixed with this review

| # | What was wrong | Fix |
|---|---|---|
| 1 | An admin password alone could delete users, make new admins, adjust wallet balances, approve top-ups and read every business. Two-step sign-in was only enforced on the money controls. | Every admin request now needs a session that passed two-step sign-in in the last 12 hours (`apps/api/src/middleware/auth.js`). Before that an admin can only set it up, enter a code, read their profile and sign out. The admin console asks for it before anything loads (`apps/business/src/components/AdminTwoStep.jsx`). |
| 2 | Session tokens accepted any HMAC algorithm. Nothing stopped the access and refresh keys being the same, which would let a 30-day refresh token work as a session token. | HS256 only; the API refuses to start if `JWT_SECRET` equals `REFRESH_TOKEN_SECRET`. |
| 3 | `.env.production.example` set `JWT_EXPIRE=7d`, so a copied file gave 7-day access tokens instead of 15 minutes. | Example now says `15m`. **Check the server** (see "Needs you"). |
| 4 | The API accepted browser calls from `localhost` pages in production. A refused origin was a 500 that paged the alert webhook. | Local origins only outside production; a refused origin is a 403. |
| 5 | Customer sign-in followed `?next=/\evil.com`, an open redirect to another site after signing in. | One strict check shared by both apps (`packages/api-client/src/safeNext.ts`). |
| 6 | 224 handlers answer failures with `res.status(500)` themselves, so neither the alert webhook nor Sentry ever heard about them. | Every 5xx answer is reported once: method and path only, never the query string. |
| 7 | Known vulnerabilities in API dependencies: 1 critical (`proxy-addr`) and several high/moderate (`ip-address`, `qs`, `body-parser`). | Patched to fixed versions within the same major (`npm audit fix`). |
| 8 | No timeout on email (Resend) or web-push calls, so a hung provider could hold a request open. | 15 s and 10 s timeouts. |
| 9 | The API image installed test tools, ran as root, and started through `npm` (which doesn't pass on the stop signal). | `npm ci --omit=dev`, runs as the `node` user, `TZ=UTC`, starts `node server.js` directly. |

## Needs you (outside the code)

1. **Rotate the secrets in public git history. This is the most important item.** The repository is public, and commit `82a2435` (June 2026) contains a JWT signing key, a MongoDB password, the Google OAuth client secret and a Gmail app password. If production still uses that JWT key, anyone can make a session for any account, including an admin with two-step "already passed". So:
   - Set new random `JWT_SECRET` and `REFRESH_TOKEN_SECRET` values with the runbook in [ROTATING_SECRETS.md](ROTATING_SECRETS.md). Everyone signs in again once. New unsubscribe links get their own key, and links already emailed can still unsubscribe but never switch email back on. If `MFA_ENCRYPTION_KEY` was never set, two-step sign-in also gets a fresh key and each admin sets two-step up again. Once the old key is useless it checks the admins and locks any you do not know (an admin made with the old key would survive the change), removes the notification subscriptions stored before the restart, and has you read the audit log, since the old key let anyone act as an existing admin. The audit log only starts on 14 October 2026, so June to October can only be checked through the admin list.
   - Change the MongoDB password, the Google OAuth client secret, and the Gmail app password (or remove it if you've moved to Resend).
   - In GitHub, turn on secret scanning and push protection.
2. **`JWT_EXPIRE` on the server:** if `/app/.env.production` says `7d`, change it to `15m` (or delete the line), then `docker compose up -d --force-recreate server`.
3. **Firewall:** the DigitalOcean cloud firewall should allow only 22, 80 and 443. SSH should be key-only, with no password login.
4. **Cloudinary photo upload preset** (unsigned, its name is in the app code):
   - images only;
   - a size limit (about 10 MB);
   - a fixed folder;
   - an incoming resize, so nobody can use the account as free storage.
5. **Google Maps key** (in the business app): restrict it to `business.bookplus.pro` and to the Maps and Places APIs.
6. **Alerts and off-site backups:** set `ALERT_WEBHOOK_URL` and the off-site backup settings (`ops/backup/README.md`). Server errors now reach the webhook, so it's worth having.
7. **MongoDB 6 is past end of life.** Pick a quiet time for the upgrade workflow.

## Worth doing later

- **Before payouts go live:** encrypt payout bank account numbers at rest, the same way two-step secrets are encrypted (`apps/api/src/models/User.js`, `payoutAccountSchema`).
- **Before packages are switched back on:** a client can "buy" a package without paying, and it counts as revenue in the business's and the admin's figures (`apps/api/src/controllers/packageController.js` `purchasePackage`).
- **Dependencies:**
  - Sentry 10 → 11 clears the remaining 23 moderate advisories, all in Sentry's tracing libraries.
  - nodemailer's advisory is about its `raw` message option, which Bookplus doesn't use.
  - React Router's open-redirect advisory is fixed only in v7; the `safeNext` fix covers the one place we navigate to a user-supplied path.
  - The vite, postcss and esbuild advisories are build tools that never reach users.
- **Edge protection:** there are no nginx `limit_req`/`limit_conn` rules and no CDN or WAF in front. The app's own rate limits are per process and reset on every deploy. Cloudflare in front would add DDoS protection and caching. Be careful with per-IP limits, because mobile networks share addresses.
- **Deploys:**
  - The health wait is non-fatal (`.github/workflows/ci-cd.yml`).
  - There's no smoke test after a deploy and no automatic rollback.
  - The API is briefly down while its container restarts.
- **Email and push failures** are logged but not retried. Reminders are claimed before sending, deliberately, so nobody gets two.
- **Database:**
  - It's a single MongoDB node: no failover and no multi-document transactions. Money writes rely on idempotent ledger keys and conditional updates instead.
  - A replica set would add transactions and point-in-time restore.
  - The inbox query has no index starting with `sender`.
- **Public marketplace lists** (`/api/providers`, `/api/services`) return everything and load every review on each request. That's fine at today's size; cache or paginate them before about 1,000 businesses.
- **Sessions:**
  - Refresh-token reuse isn't detected; tokens are rotated but not consumed.
  - The 15-minute access token and a profile copy sit in the browser's localStorage. The strict Content-Security-Policy limits the damage, and keeping the access token in memory would remove it.

## Checklist 1 — the 30 security mistakes

| # | Item | Status | Where it stands |
|---|---|---|---|
| 1 | Client-side auth bypass | OK · Fixed | Every API route checks the session and role on the server; the apps' route guards are only for display. Admin requests now also need two-step (Fixed 1). |
| 2 | Missing row-level security | N/A | Browsers never reach MongoDB. Every read goes through the API, which scopes it to the signed-in account or business. |
| 3 | IDOR | OK | All 61 look-ups by an id from the URL are scoped to the owner or business, or checked before use. They're covered by the authorization test suites. Payment status links use unguessable 112-bit references. |
| 4 | Weak session handling | OK · Fixed · You | Access tokens last 15 minutes. Refresh tokens last 30 days, rotate, and live in an httpOnly cookie. Signing out or changing the password revokes every session (`tokenVersion`). Fixed 3; check the server value (You 2). |
| 5 | Unprotected admin routes | Fixed | Server-side role checks were already there; two-step is now required too. |
| 6 | Weak or predictable JWT secrets | Fixed · **You** | In production the API refuses to start with keys under 32 characters. HS256 is pinned and the two keys must differ. **The old key in public history must be rotated** (You 1). |
| 7 | Hard-coded secrets | OK · **You** | The current code is clean (only `*.example` placeholders). Old values are still in git history (You 1). |
| 8 | Private keys in the browser bundle | OK · You | Bundles contain only public values: the API address, the Maps key, and the Cloudinary cloud and preset names. Lock down the Maps key and the preset (You 4, 5). |
| 9 | `.env` files committed | OK | Only `*.example` files are tracked; `.gitignore` covers `.env*`. |
| 10 | Public storage buckets | OK · You | ID documents, bank letters, proofs of payment and dispute evidence are private on Cloudinary, shown through 5-minute signed links. Off-site backups are encrypted (rclone crypt). Photos are public by design. |
| 11 | Open database ports | OK | MongoDB and the API aren't published on the host; only nginx's 80 and 443 are. |
| 12 | Firewall defaults | You | Host setup turns on ufw and fail2ban for SSH. Confirm the cloud firewall (You 3). |
| 13 | SQL injection | OK | No SQL. For MongoDB: `express-mongo-sanitize`, every regex built from input is escaped, no `$where`, no raw request objects in queries. |
| 14 | XSS | OK | React escaping, no `dangerouslySetInnerHTML`, strict CSP with script hashes. Emails and share-preview pages escape what users type. |
| 15 | Unvalidated uploads | OK · You | Private uploads are signed by the server, limited to set file types and pinned to a folder, and checked again when saved. Photo preset limits are You 4. |
| 16 | Tokens or PII in browser storage | Later | The refresh token is in an httpOnly cookie. The 15-minute access token and a profile copy are in localStorage, limited by the CSP. |
| 17 | Silent business-logic errors | OK · Later | Fees, the ledger, refunds, payouts, disputes and the finance dashboard are tested against worked examples. One gap: unpaid package "purchases" counted as revenue (feature off). |
| 18 | Unbounded queries | Later | Admin lists and reviews are paged. The public marketplace lists aren't, and a few per-item queries remain. |
| 19 | Hallucinated packages | OK | 21 API and 10–15 app dependencies, all well-known, installed only from lockfiles. |
| 20 | Known CVEs | Fixed · Later | Fixed 7; the rest are in Later. Dependabot runs weekly. |
| 21 | Bloated dependencies | OK | Small dependency lists; no unused API packages. |
| 22 | Insecure deserialization | OK | No `eval`, `vm` or object serializers. PayGate XML is parsed (never built), and responses are capped at 1 MB. |
| 23 | Missing security headers | OK | CSP, HSTS, `frame-ancestors`/X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy on the API and both apps. |
| 24 | Loose CORS | Fixed | An allowlist of the apps' own addresses only (Fixed 4). |
| 25 | No rate limiting | OK · Later | Sign-in is limited per IP and per account, other routes have read and write budgets, and PayGate's notify has its own limit. There's no edge limit yet. |
| 26 | No CSRF protection | OK | The API takes the session in a header, not a cookie. The refresh cookie is HttpOnly, Secure, SameSite=Lax and limited to `/api/auth`. |
| 27 | Unverified payment webhooks | OK | PayGate's checksum is compared in constant time, and Bookplus asks PayGate for the result before trusting it. Ledger keys make repeats harmless. |
| 28 | Code nobody can debug | OK · Fixed | Architecture docs, handbook and runbooks; structured logs with secrets redacted; server errors now alert (Fixed 6). |
| 29 | No tests | OK | About 1,570 API tests, about 650 business unit tests, and Playwright end-to-end tests for both apps. They run on every pull request and gate every deploy. |
| 30 | Code ownership | OK · You | The code, lockfiles, migration scripts, CHANGELOG and version tags are all in the repository. When it moves to the new organisation, move the Actions secrets and the production environment with it. |

## Checklist 2 — the engineering list

| Area | Status | Where it stands |
|---|---|---|
| Rate limiting | OK | See 25 above. |
| Caching / CDN / edge / cache invalidation | Partly | Hashed app assets are cached for a year and `index.html` is never cached. Prices are cached for 30 s in the API. No CDN, and no API response cache. |
| Reverse proxy / load balancing / API gateway | OK / N/A | nginx terminates TLS and proxies to one API. A gateway isn't needed. |
| Docker / CI/CD / build caching | OK · Fixed | Per-commit images; tests and end-to-end checks gate the deploy; pnpm and Docker layer caches. Image hardening is Fixed 9. |
| Timeouts | Fixed | PayGate, Cloudinary and the alert webhook were already capped (20 s, 20 s, 5 s), along with SMTP and MongoDB. Email (Resend) and push were added. |
| Retries / exponential backoff / circuit breakers | Partly | Refunds keep a retry state with a manual retry, and open payments are re-checked every minute. No automatic backoff, and no breaker for PayGate. |
| Idempotency | OK | Unique ledger keys, unique payment references, and status-guarded updates. A double booking submit is refused by the slot lock. |
| Message queues / pub-sub / event-driven / dead letters | Not used | Side effects run inline or in scheduled jobs. Failed emails and pushes are logged, not queued. |
| Distributed transactions / saga | Partly | Single node, so no transactions. Batch reschedule rolls back by compensation. |
| Cron jobs / leader election | OK | Five jobs, each behind a database lease lock (`CronLock`), so a second API instance wouldn't double-run them. |
| WebSockets / long polling / SSE | Polling | The apps poll every 8–60 s and pause in hidden tabs. Fine at this size. |
| Database indexing / query optimisation / N+1 | Mostly OK | Bookings have about 14 indexes. A few per-item queries and the inbox index are in Later. |
| Connection pooling | OK | MongoDB pool of 10. |
| Locking / race conditions | OK | Per-person, per-day booking lock with a re-check inside it, conditional wallet updates, and serialized payouts. An overlap report runs on every deploy. |
| Memory leaks / garbage collection / backpressure | OK | No long-lived timers or unbounded maps. Body size limits and container memory limits. |
| Horizontal / vertical scaling / autoscaling | Not yet | One droplet. Cron and booking locks would survive a second instance; rate limits and the price cache are per instance. |
| Feature flags | OK | `PAYMENTS_ENABLED`, `MEMBERSHIPS_ENABLED`, `WALLET_ENABLED`, plus app flags at build time. |
| Blue-green / canary / rolling deploys / rollbacks | Partly | Images are pinned per commit and `ops/rollback.sh` exists. Deploys restart in place, with no automatic rollback. |
| Health checks / liveness / readiness | OK | Health checks on every container. `/api/health` answers 503 when the database is down. The uptime check runs every 10 minutes. |
| Monitoring / logging / alerting / tracing / metrics | Partly · Fixed | Logs are redacted, crashes and 5xx go to the alert webhook, and Sentry is ready once `SENTRY_DSN` is set. No metrics or tracing. |
| SLOs / SLIs / error budgets / p99 / latency / throughput | Not measured | Request time is in the nginx log only. |
| Secrets management / IAM | Partly · You | Environment file on the server (mode 600) and GitHub secrets. Finance and director roles with two-step. Secret rotation is You 1. |
| OAuth | OK | Google sign-in with a signed state value; an unverified Google email is never linked. |
| JWT rotation | OK · Later | Rotating refresh tokens, `tokenVersion` revocation. No reuse detection; one signing key. |
| TLS / encryption in transit | OK | Let's Encrypt renewal, HTTP/2, HSTS. Traffic between containers stays on the private Docker network. |
| Encryption at rest | Partly | Two-step secrets are AES-256-GCM and off-site backups are encrypted. Bank numbers are a Later item. |
| SQL injection / XSS / SSRF / CORS / CSRF | OK · Fixed | See 13, 14, 24, 26. Outbound calls go only to fixed hosts; push endpoints are allowlisted. |
| Database migrations / schema versioning | Partly | Idempotent migration scripts run on every deploy. No migration ledger. |
| Backups / disaster recovery / failover / replication | Partly · You | Nightly dump plus one before each deploy, kept 14 days, with a restore test workflow. Off-site is You 6. Single node, so no failover. |
| Multi-region, Kubernetes, Helm, gRPC, service discovery, sharding, partitioning, read replicas, chaos engineering, serverless, cold starts | N/A | Not needed for one droplet. |
| Webhooks | OK | See 27. |
| API versioning / semantic versioning | Partly | Releases are tagged and listed in CHANGELOG.md. The API has no `/v1`, which only matters once outside clients use it. |
| Infrastructure as code / Terraform | Not used | Server setup is in workflows (`host-setup.yml`), not Terraform. |
| Dependency hell | OK | Lockfiles, frozen installs, weekly Dependabot, Actions pinned by SHA, Node 24 LTS. |
| Clock skew / time zones | OK | Namibia time is handled in one place, the container clock is pinned to UTC (Fixed 9), and two-step codes allow ±30 s. |
| DNS / HTTP/2-3 / TCP-UDP | OK | HTTP/2 on. DNS is managed by hand. |
| Production incidents / on-call / postmortems | Partly | Runbooks exist, and uptime failures open a GitHub issue. No on-call rota or postmortem template. |
| WAF / DDoS protection | Later | See edge protection. |
| Cost optimisation | OK | One small droplet with memory limits, and old images are pruned. |
