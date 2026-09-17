# Dual-app deploy topology (originally the Epic 1.4 rollout runbook)

Everything below the "owner steps" line is automated: CI builds and pushes
three images (`erastusm/bookplus-server`, `erastusm/bookplus-customer`,
`erastusm/bookplus-business`), syncs `docker-compose.yml` +
`nginx/conf.d/bookplus.conf` + `ops/` to the droplet, runs
`compose pull && up -d --force-recreate`, waits for the API healthcheck, and
executes the idempotent data migrations (`migrate_team_colors.js`,
`migrate_account_types.js`). See `.github/workflows/ci-cd.yml`.

## Which commit is live — per-deploy image pinning

Every image is tagged with the commit that built it, and the deploy ships that
exact tag. It is not `:latest`.

That distinction is the whole point. `:latest` is one mutable pointer, and two
overlapping runs on `main` both write it: whichever **build** finished last won,
regardless of which **commit** was newer. An older commit finishing second left
`:latest` on older code, and the next deploy shipped it under a green tick. The
deploy concurrency group never covered this — it serializes deploys, not builds.

How it works now:

| Piece | What it does |
|---|---|
| `build-and-push` | Tags each image `:<commit-sha>` **and** `:latest`. Only one run ever writes a given sha tag, so there is nothing to race over. |
| `deploy` | Refuses to run if the commit is no longer the tip of `main`, then pins `IMAGE_TAG=<sha>` in `/app/.env` and brings the stack up on it. |
| `docker-compose.yml` | Reads `${IMAGE_TAG:-latest}` for all three app services, so they always move together as one commit. |
| Verification | After the rollout the deploy compares each container's image ID against the pinned tag and **fails loudly** if they differ. A silent wrong-commit deploy is no longer possible. |

`/app/.env` is the droplet's own record of what is live, so a later bare
`docker compose up -d` / `run` / `exec` in `/app` — by a human, by
`expand-tls.yml`, or by `init-letsencrypt.sh` — reproduces the running release
instead of resurrecting something else. Read it to answer "what is deployed":

```bash
ssh <droplet> 'cat /app/.env | grep IMAGE_TAG'
# IMAGE_TAG=<the live commit>
# PREVIOUS_IMAGE_TAG=<the rollback target>
```

`:latest` is still published for humans and is the compose fallback, but nothing
automated consumes it. Under a build race the registry's `:latest` may briefly
name an older commit — harmless now. On the droplet, each successful rollout
retags the **local** `:latest` onto itself, so the fallback always means "what is
live" rather than freezing at whatever was pulled before this change.

## Rolling back

```bash
ssh <droplet>
cd /app && sh ops/rollback.sh              # the previous release
cd /app && sh ops/rollback.sh <commit-sha> # a specific one
```

It fetches the target (proving it exists before repointing anything), re-pins
`/app/.env`, recreates the stack, waits for health, and **verifies all three
containers are actually on that commit** — refusing to report success otherwise.
No rebuild and no YAML editing: the images are already built and tagged.

Two honest limits, both deliberate:

- **Images only.** `docker-compose.yml` and `nginx/conf.d/bookplus.conf` on the
  droplet come from the newest `main`, synced before the rollback runs. A
  regression living in the nginx config or the compose topology is *not* undone
  by a rollback — revert the commit on `main` instead.
- **It is not durable.** The next merge to `main` deploys forward again. A
  rollback buys time; reverting the bad commit is what makes it stick.

After a rollback, `PREVIOUS_IMAGE_TAG` is cleared rather than set to the build
you just escaped, so a second no-argument `rollback.sh` cannot re-ship it. Going
back further takes an explicit sha.

## When a deploy is skipped

The deploy refuses to run when its commit is no longer the tip of `main`, because
deploys are serialized but **builds are not** — an older commit's slower build can
otherwise finish last and take production backwards. A skipped run is green and
says so in its job summary.

Almost always the newer commit's own run deploys it and there is nothing to do.
One case needs a human, and it is worth knowing:

> Deploy jobs enter the `deploy-production` concurrency group when their build
> finishes, and GitHub holds only **one running plus one pending** job per group —
> a third arrival cancels the pending one. With three merges in flight, an older
> commit's late-finishing deploy can evict a newer commit's pending deploy. The
> older one then runs and correctly refuses itself, and the newest commit is never
> deployed until the next merge.

This is a **stall, not a wrong-version deploy** — shipping older code is impossible
now. To check and recover:

```bash
ssh <droplet> 'grep IMAGE_TAG /app/.env'   # should equal main's tip
```

If it doesn't match, re-run the deploy job on the workflow run for main's tip.
Merging one PR at a time — the house rule anyway, since concurrent deploys once
took production down — avoids the window entirely.

## Disk retention

Per-commit tags are never dangling, so `docker image prune -f` — which only
removes untagged images — stopped being able to reclaim app images. Left alone
that fills the droplet over weeks. The deploy therefore trims to the **3 newest
tags per repository** (live, rollback target, one spare) and does it **before**
pulling, so that a nearly-full disk can still deploy and so images left behind by
a *failed* deploy are collected by the next one. `docker rmi` refuses to delete
an image a container is using, so the live set is safe by construction.

## Owner steps (one-time — ✅ all complete; kept for rebuild-from-scratch)

1. **DNS** — ✅ done. A records for `www.bookplus.pro` and
   `business.bookplus.pro` point at the droplet, alongside the apex, `api.`
   and the legacy `app.` names. Keep the `app.` record: nginx 301s it to
   `www` for early bookmarks, and the TLS cert lists it as a SAN — deleting
   the record would break both the redirect and cert renewal.

2. **TLS** — ✅ done. The live certificate covers all five SANs. To re-issue
   from scratch, run the repo's `init-letsencrypt.sh` (its `domains` list
   must match the five names below — check it before running):
   ```bash
   cd /app && ./init-letsencrypt.sh
   ```
   (Or: `docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
   --expand -d bookplus.pro -d www.bookplus.pro -d api.bookplus.pro \
   -d app.bookplus.pro -d business.bookplus.pro` then `docker compose exec nginx nginx -s reload`.)

3. **API env** — ✅ done, and the deploy job now keeps it in shape
   idempotently on every deploy: it ensures `COOKIE_DOMAIN=.bookplus.pro`
   (refresh-cookie scope — sessions stay per side regardless, scoped by
   `accountType`), strips the retired `app.bookplus.pro` origin from
   `CLIENT_URL`, and appends `https://business.bookplus.pro` to it.

## What ships where

| Origin | Serves | Image |
|---|---|---|
| `bookplus.pro` (apex) | 301 → `www.bookplus.pro` | — (nginx) |
| `www.bookplus.pro` | customer marketplace (Vite) | `erastusm/bookplus-customer` |
| `app.bookplus.pro` | 301 → `www.bookplus.pro` (keeps early bookmarks working) | — (nginx) |
| `business.bookplus.pro` | provider/staff/admin suite (Vite) | `erastusm/bookplus-business` |
| `api.bookplus.pro` | the one shared API | `erastusm/bookplus-server` |

nginx also proxies `www.bookplus.pro/sitemap.xml` + `/robots.txt` to the API,
and rewrites social-crawler hits on `/b/` + `/providers/` to the API's
prerender endpoint for share cards.

## Legacy client — retired ✅

The CRA client no longer ships anywhere: `www` serves the customer app, there
is no `client` service in `docker-compose.yml`, and the `bookplus-client`
image is no longer built or pushed.
