# Ionic/Capacitor native — backend dependencies (apps/api)

Two `apps/api` changes are **hard blockers** for the native (iOS/Android) apps.
They are outside the front-end migration's scope to build, but native is
**dead-on-arrival** without them, and both have real lead time — **start now,
in parallel with Phase 0.** Web/PWA is unaffected by either.

Copy each section into an issue in the tracker.

---

## Ticket 1 — Add native origins to the credentialed CORS allowlist

**Priority:** P0 (blocks all native API access) · **Component:** apps/api

**Problem.** `@bookplus/api-client` sends requests with `withCredentials: true`.
The CORS spec forbids `Access-Control-Allow-Origin: *` on credentialed requests,
so the server must echo an explicit allowed origin. In a Capacitor WebView the
page origin is **not** `https://app.bookplus.pro` — it is `capacitor://localhost`
(iOS) or `http://localhost` / `https://localhost` (Android/config-dependent).
None of these are in the allowlist today, so **every native API call fails the
CORS preflight** and the app can't log in or load data.

**Ask.** Add to the credentialed CORS allowlist (the `CLIENT_URL` / allowed-origins
config, wherever `cors()` origin is set):
- `capacitor://localhost`
- `http://localhost`
- `https://localhost`

Keep `credentials: true` and reflect the specific matched origin (not `*`).
Confirm `OPTIONS` preflight returns the matching `Access-Control-Allow-Origin`
and `Access-Control-Allow-Credentials: true`.

**Acceptance.** From a device/emulator Capacitor build: login → authed `GET`
→ forced 401 → silent refresh all succeed with no CORS error in the WebView
console.

**Notes.** Also register the **native OAuth redirect URI** (custom scheme /
`appUrlOpen` deep link) for the Google sign-in flow — `AuthCallBack.jsx` reads
`?code=`, and the WebView can't complete the current web redirect.

---

## Ticket 2 — Accept native APNs/FCM device tokens for push

**Priority:** P1 (blocks native push only; web push unaffected) · **Component:** apps/api

**Problem.** `POST /push/subscribe` currently accepts a **web `PushSubscription`**
(endpoint + keys) and delivers via web-push + VAPID. `@capacitor/push-notifications`
produces an **opaque APNs (iOS) / FCM (Android) device token** instead. The
current endpoint can neither store nor deliver to those, so **native push never
works** until the backend handles device tokens.

**Ask.**
1. Extend the push subscription store/model to persist native device tokens
   tagged by platform (`web` | `ios` | `android`) per user.
2. Accept a native-token registration payload (device token + platform) —
   either extend `POST /push/subscribe` or add `POST /push/register-device`.
3. Add a send path that delivers via **APNs** (iOS) and **FCM** (Android)
   alongside the existing web-push path, fanning out to all of a user's tokens.
4. Handle token invalidation/unregister (uninstalls, token rotation).

**App-side / infra prerequisites (track alongside):**
- iOS: **Push Notifications capability + APNs key/cert** on the Apple app ID.
- Android: **FCM `google-services.json`** and server key.
- Deep-link routing: the notification-tap `data.url` must route through the
  in-app router (converges with `NotificationBell` navigation) — front-end work,
  but the payload shape must be agreed here.

**Acceptance.** A booking event triggers a delivered push on a physical
iOS device and an Android device; tapping it deep-links to the correct screen.

---

## Summary

| Ticket | Blocks | Web impact | Must land by |
|--------|--------|-----------|--------------|
| 1 — CORS native origins | All native API access (login, data) | None | End of Phase 0 |
| 2 — Native push tokens | Native push notifications | None | Phase 3 (customer push) |
