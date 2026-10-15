# Rotating secrets

How to change the production secrets in `/app/.env.production`. Run every
command on the server, from `/app`. None of them shows a secret value. Never
paste secret values into chat, issues or GitHub: Actions logs are public.

## JWT keys (`JWT_SECRET`, `REFRESH_TOKEN_SECRET`)

**What changes for people**

- Everyone is signed out once: clients, businesses, team members and admins.
  They sign in again; nothing else is lost.
- A Google sign-in or a two-step code that is in progress during the restart
  has to be started again.
- Password resets, invites and email checks already sent keep working. They
  use their own random tokens.
- Unsubscribe links already sent keep working, but only to unsubscribe. Their
  "Undo" is replaced by how to get the emails back: account settings, or for
  guests, the box on their next booking. Those links were signed with a key
  derived from the old `JWT_SECRET`, which is public, so anyone could make
  one; they must never switch email back on. Links in new emails use a fresh
  key (step 3).
- Phone and browser notifications switched on before the change stop, and
  the app shows them as off, so people turn them on again (one tap on the
  banner, or the switch in settings). Step 7 explains why.
- Admins' two-step sign-in keeps working if `MFA_ENCRYPTION_KEY` is set (step 1
  tells you). If it is not, the authenticator secrets are encrypted with a key
  derived from the old `JWT_SECRET`. They get a fresh key, and each admin sets
  two-step up again (steps 4b and 9): scan a new QR code and save the new
  recovery codes.
- Anyone with the old key could sign in as any account, including an existing
  admin, and could have made an account an admin. Changing the key does not
  undo what was done. Step 6 checks the admins once the old key stops working,
  and step 10 reviews what was recorded.

**Time:** about 20 minutes. The API, MongoDB and the backup containers (the
services that read this file) restart once, with about 20 seconds of errors on
the API. The websites stay up.

### 0. Check the server has this runbook's scripts, and the last deploy finished

```sh
cd /app
docker compose exec -T server node scripts/key_status.js
t=$(sed -n 's/^IMAGE_TAG=//p' .env | tail -n1)
for s in server customer business; do [ "$(docker image inspect -f '{{.Id}}' "erastusm/bookplus-$s:$t" 2>/dev/null || echo missing)" = "$(docker inspect -f '{{.Image}}' "bookplus-$s" 2>/dev/null || echo none)" ] && echo "$s: live" || echo "$s: NOT LIVE"; done
m=$(sed -n 's/^MONGO_VERSION=//p' .env | tail -n1); [ "$(docker inspect -f '{{.Config.Image}}' bookplus-mongo 2>/dev/null || echo none)" = "mongo:${m:-6.0}" ] && echo "mongodb: live" || echo "mongodb: NOT LIVE"
```

- The first command lists the keys. If it says "Cannot find module", the
  deploy with this runbook has not reached the server yet.
- All four should say `live`. If one says `NOT LIVE`, the last deploy (or
  MongoDB upgrade) stopped half-way, and step 5 would put that half-finished
  change live. Re-run that workflow in GitHub Actions, wait for it to go
  green, then start again from step 0.

### 1. Check what is set

The first command in step 0 shows what the running API sees, never the values.
Also count each name in the file:

```sh
grep -oE '^(JWT_SECRET|REFRESH_TOKEN_SECRET|JWT_EXPIRE|MFA_ENCRYPTION_KEY|UNSUBSCRIBE_KEY|UNSUBSCRIBE_KEY_LEGACY)=' .env.production | sort | uniq -c
```

- Every count should be `1`. If a name appears twice, stop and fix that first.
- Note the `id` of `JWT_SECRET` and of `REFRESH_TOKEN_SECRET`. They are hash
  fragments, not the keys. Step 5 checks that they changed.
- `MFA_ENCRYPTION_KEY: set` means two-step sign-in is not affected.
  `NOT SET` or `NOT USABLE` means steps 4b and 9 are for you.
- `UNSUBSCRIBE_KEY: not set` means step 3 is for you (the first rotation).
  If it says `set`, skip steps 3 and 8.
- `JWT_EXPIRE` should be `15m`, or `not set (15m)`. Step 4 fixes `7d`.

### 2. Back up the file

```sh
[ -e .env.production.bak ] || cp -p .env.production .env.production.bak
```

If you start again after an interruption, this keeps the first backup.

### 3. Unsubscribe links: keep the old key for unsubscribing, and add a new one

Only if step 1 said `UNSUBSCRIBE_KEY: not set`.

```sh
[ -s /tmp/unsubscribe-sample ] || docker compose exec -T server node scripts/unsubscribe_key.js sample > /tmp/unsubscribe-sample
legacy=$(docker compose exec -T server node scripts/unsubscribe_key.js) && sed -i '/^UNSUBSCRIBE_KEY\(_LEGACY\)\?=/d' .env.production && { [ -z "$(tail -c1 .env.production)" ] || echo >> .env.production; } && printf '%s\nUNSUBSCRIBE_KEY=%s\n' "$legacy" "$(openssl rand -hex 32)" >> .env.production; unset legacy
grep -cE '^UNSUBSCRIBE_KEY(_LEGACY)?=[0-9a-f]{64}$' .env.production
```

It should print `2`. Running it again before step 5 is safe and still prints
`2`. (The first line saves a test link for rotation-check@example.com, which
step 8 checks. It is not a secret.)

### 4. New keys

```sh
[ -z "$(tail -c1 .env.production)" ] || echo >> .env.production
for k in JWT_SECRET REFRESH_TOKEN_SECRET; do
  sed -i "/^$k=/d" .env.production
  echo "$k=$(openssl rand -hex 32)" >> .env.production
done
sed -i 's/^JWT_EXPIRE=.*/JWT_EXPIRE=15m/' .env.production
```

**4b.** Only if `MFA_ENCRYPTION_KEY` is `NOT SET` or `NOT USABLE`:

```sh
sed -i '/^MFA_ENCRYPTION_KEY=/d' .env.production
echo "MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env.production
```

Check. Every count should be `1`, and both keys should be `changed`:

```sh
grep -oE '^(JWT_SECRET|REFRESH_TOKEN_SECRET|JWT_EXPIRE|MFA_ENCRYPTION_KEY|UNSUBSCRIBE_KEY|UNSUBSCRIBE_KEY_LEGACY)=' .env.production | sort | uniq -c
for k in JWT_SECRET REFRESH_TOKEN_SECRET; do
  [ "$(grep "^$k=" .env.production)" = "$(grep "^$k=" .env.production.bak)" ] && echo "$k NOT changed" || echo "$k changed"
done
chmod 600 .env.production
```

### 5. Restart what reads the file

```sh
docker compose up -d
for i in $(seq 1 40); do s=$(docker inspect -f '{{.State.Health.Status}}' bookplus-server 2>/dev/null); [ "$s" = healthy ] && break; sleep 3; done; echo "API: $s"
curl -s https://api.bookplus.pro/api/health; echo
docker compose exec -T server node scripts/key_status.js
```

Because step 0 found the running containers matching `/app/.env`,
`docker compose up -d` recreates only the services whose settings changed:
the API, MongoDB and the two backup containers. Otherwise the next deploy
would restart MongoDB by surprise.

You should see:

- `API: healthy`, and `{"success":true,"db":"connected",...}`.
- `JWT_SECRET` and `REFRESH_TOKEN_SECRET` with ids different from step 1.
- `MFA_ENCRYPTION_KEY: set`.
- `UNSUBSCRIBE_KEY: set`, and after step 3, `UNSUBSCRIBE_KEY_LEGACY: set`.
- No `PROBLEM` lines.

From here on the old key is useless. nginx finds the new containers by itself,
so no reload is needed. If the health check still gives 502 after 20 seconds,
reload nginx:

```sh
docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload
```

If the API is not healthy, see "If something goes wrong" below.

### 6. Check the admins

```sh
docker compose exec -T server node scripts/reset_admin_mfa.js --list
```

Each line starts with the account's id, then its email.

- Every email listed should be someone you know is a Bookplus admin. Shut out
  each one you do not know, straight away, by its **id** (the first column).
  Do not paste the email: whoever made that account chose it, and an email can
  contain characters the shell would run.

  ```sh
  docker compose exec -T server node scripts/reset_admin_mfa.js --lock 0123456789abcdef01234567 "Unknown admin, JWT rotation"
  ```

  It also says if that admin prepared money requests that are still waiting;
  step 10 rejects them. Then run `--list` again. Each of them should now say
  `SUSPENDED`.
- If `MFA_ENCRYPTION_KEY` was not set, also note every email you know that
  says `two-step on`. Step 9 needs them.

### 7. Remove the notification subscriptions from before the restart

```sh
docker compose exec -T server node scripts/clear_push_subscriptions.js "$(docker inspect -f '{{.State.StartedAt}}' bookplus-server)"
```

It prints how many it removed. Anyone with the old key could have sent any
account's notifications to their own device, and nobody can see that. Only
subscriptions stored before the API restarted in step 5 are removed; anything
since then came from a real session. On those devices the app now shows
notifications as off, and people turn them on again.

### 8. Check that old unsubscribe links still unsubscribe

Only if you did step 3.

```sh
docker compose exec -T server node scripts/unsubscribe_key.js check "$(cat /tmp/unsubscribe-sample)"
```

It should print `OK: links emailed before the change can still unsubscribe.`

### 9. If `MFA_ENCRYPTION_KEY` was not set: two-step again for each admin

For each admin you know from step 6 that said `two-step on`:

```sh
docker compose exec -T server node scripts/reset_admin_mfa.js admin@example.com "JWT key rotation"
```

Then each of those admins does this at
https://business.bookplus.pro/bkplus-command/login:

1. Sign in.
2. In the authenticator app, delete the old Bookplus entry.
3. Set up two-step sign-in again: scan the new code and enter the 6-digit code.
4. Save the new recovery codes.

### 10. Sign in, check, and review

- business.bookplus.pro: sign in as a business, and the dashboard loads.
- app.bookplus.pro: sign in as a client.
- business.bookplus.pro/bkplus-command: the admin console opens after the code.
- In the console, read all of Settings → Audit log. The old key let anyone
  act as an existing admin, so anything odd would be recorded under a real
  admin's name. Each admin should recognise what is recorded under their name:
  payout account changes, approvals, online payments switched on or off,
  payouts, money roles and the security entries, plus payout runs and wallet
  adjustments. The log starts on 14 October 2026 and records money and
  two-step actions only. From 3 June (when the key became public) to then,
  nothing was recorded, and making someone an admin, suspending and deleting
  are never recorded. For those, step 6 is the check.
- If step 6 found an admin you did not know:
  1. In the console, open Money, Approvals and reject every waiting request
     that admin prepared (reason: preparer locked).
  2. Open Users, find the email and choose Remove admin. It is already
     suspended; do not press Activate.
  3. Run `docker compose exec -T server node scripts/reset_admin_mfa.js --list`
     again. Only admins you know should be listed; any other must say
     `SUSPENDED`.
  4. Treat it as a break-in. Check the audit log, payouts and wallets before
     anything else.

Tabs that were open before the change show the sign-in page. That is expected.

### 11. Clean up

When everything above works:

```sh
shred -u .env.production.bak
rm -f /tmp/unsubscribe-sample /tmp/rotation-failure.log
```

### If something goes wrong

**The API does not become healthy in step 5.** First save the log of the
failing containers: restarting removes them, and their log goes with them.
Secret values never appear in the log.

```sh
docker compose logs --no-color --tail 50 server mongodb > /tmp/rotation-failure.log
cp -p .env.production.bak .env.production
docker compose up -d
```

Then run the health check from step 5 again, which should say `API: healthy`,
and read `/tmp/rotation-failure.log` to find out why it failed before trying
again. The old key works again until you do.

**An admin cannot get past two-step after step 9.** Run that admin's reset
again, and set two-step up again.
