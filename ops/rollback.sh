#!/bin/sh
# Put a previous release back in production, on the droplet.
#
#   cd /app && sh ops/rollback.sh              # -> PREVIOUS_IMAGE_TAG from /app/.env
#   cd /app && sh ops/rollback.sh <commit-sha> # -> that exact commit
#
# Every deploy tags its images with the commit sha and records the pin in
# /app/.env, so rolling back is re-pointing that pin at a build that already
# exists — no rebuild, no YAML editing, no guessing.
#
# TWO THINGS THIS DOES NOT DO, deliberately:
#
#  1. It rolls back IMAGES ONLY. /app/docker-compose.yml and
#     /app/nginx/conf.d/bookplus.conf are synced from the newest main by the
#     deploy job before this ever runs, so a regression that lives in the nginx
#     config or the compose topology is NOT undone here. For those, revert the
#     commit on main and let a normal deploy carry it.
#  2. It does not hold off the next deploy. Production stays on the rolled-back
#     release only until the next merge to main, which deploys forward again.
#     Revert the bad commit on main, or nothing durable has happened.
set -eu

REPOS="server customer business"
cd "$(dirname "$0")/.."   # /app, wherever this was invoked from

current="$(sed -n 's/^IMAGE_TAG=//p' .env 2>/dev/null | tail -n1 || true)"
target="${1:-$(sed -n 's/^PREVIOUS_IMAGE_TAG=//p' .env 2>/dev/null | tail -n1 || true)}"

if [ -z "$target" ]; then
    echo "No rollback target." >&2
    echo "  /app/.env records no PREVIOUS_IMAGE_TAG — that is expected right after a" >&2
    echo "  rollback (it is cleared so a second run can't re-ship the bad build) or" >&2
    echo "  before this droplet's second pinned deploy." >&2
    echo "  Pass one explicitly:  sh ops/rollback.sh <commit-sha>" >&2
    echo "  Locally available builds:" >&2
    docker images --format '    {{.Repository}}:{{.Tag}}  ({{.CreatedSince}})' erastusm/bookplus-server >&2 || true
    exit 1
fi

if ! echo "$target" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "Refusing: '$target' is not a 40-character commit sha." >&2
    exit 1
fi

if [ "$target" = "$current" ]; then
    # /app/.env is what the last deploy INTENDED, which is not always what is
    # running: a deploy that failed after writing its pin leaves exactly that
    # mismatch, and that is precisely the state someone runs this script in. So
    # confirm against the containers before no-opping — otherwise a retried
    # rollback prints a reassuring "nothing to do" and exits 0 over the broken
    # release it was invoked to remove.
    drift=0
    for svc in $REPOS; do
        want="$(docker image inspect -f '{{.Id}}' "erastusm/bookplus-$svc:$target" 2>/dev/null || echo missing)"
        have="$(docker inspect -f '{{.Image}}' "bookplus-$svc" 2>/dev/null || echo none)"
        if [ "$want" = missing ] || [ "$want" != "$have" ]; then drift=1; fi
    done
    if [ "$drift" = 0 ]; then
        echo "Already running $target — nothing to do."
        exit 0
    fi
    echo "/app/.env already names $target, but the containers do not match it."
    echo "Re-converging onto $target rather than reporting success."
fi

echo "Rolling back:  $current  ->  $target"

# Fetch the target explicitly rather than `docker compose pull`, which would also
# pull mongo:6.0, nginx:alpine and certbot/certbot — floating tags that must not
# change underneath you in the middle of an incident. Proves the target exists
# BEFORE anything is repointed, so a typo'd sha leaves production untouched.
for svc in $REPOS; do
    img="erastusm/bookplus-$svc:$target"
    docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img" || {
        echo "ABORT: cannot get $img — production is untouched." >&2
        exit 1
    }
done

# Re-pin. PREVIOUS_IMAGE_TAG is CLEARED rather than set to the build we are
# rolling away from: leaving it would make a second `sh ops/rollback.sh` with no
# argument re-ship the broken release, which is exactly what a panicking operator
# would run. Going back further is a deliberate act with an explicit sha.
{
    grep -v -E '^(IMAGE_TAG|PREVIOUS_IMAGE_TAG)=' .env 2>/dev/null || true
    echo "IMAGE_TAG=$target"
} > .env.next && mv .env.next .env

# Full recreate, matching the deploy path exactly. NOT scoped to the three app
# services: nginx resolves `server`, `customer` and `business` once when its
# config loads and has no resolver directive, so recreating those three without
# restarting nginx leaves it proxying to dead IPs — a 502 on every request,
# during an incident.
docker compose up -d --force-recreate

for i in $(seq 1 40); do
    status="$(docker inspect -f '{{.State.Health.Status}}' bookplus-server 2>/dev/null || echo unknown)"
    if [ "$status" = healthy ]; then echo "API container healthy"; break; fi
    echo "waiting for API health ($status)..."
    sleep 3
done

# Never print success on faith. Compares image IDs, not reference strings, since
# what `.Config.Image` reports varies by Docker version.
for svc in $REPOS; do
    want="$(docker image inspect -f '{{.Id}}' "erastusm/bookplus-$svc:$target" 2>/dev/null || echo missing)"
    have="$(docker inspect -f '{{.Image}}' "bookplus-$svc" 2>/dev/null || echo none)"
    if [ "$want" = missing ] || [ "$want" != "$have" ]; then
        echo "ROLLBACK FAILED: bookplus-$svc is not running $target (container image $have, expected $want)" >&2
        echo "Production is in an unknown state — check 'docker compose ps' now." >&2
        exit 1
    fi
done

status="$(docker inspect -f '{{.State.Health.Status}}' bookplus-server 2>/dev/null || echo unknown)"
if [ "$status" != healthy ]; then
    echo "ROLLBACK FAILED: containers are on $target but bookplus-server is '$status', not healthy." >&2
    echo "  docker compose logs --tail=50 server" >&2
    exit 1
fi

# Keep the local :latest fallback honest — it should always mean "what is live".
for svc in $REPOS; do
    docker tag "erastusm/bookplus-$svc:$target" "erastusm/bookplus-$svc:latest" || true
done

echo
echo "ROLLED BACK to $target — server, customer and business verified, API healthy."
echo "Rolled away from: $current"
echo "This lasts until the next merge to main. Revert the bad commit there to make it stick."
