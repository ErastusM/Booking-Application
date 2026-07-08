# Bookplus — Mobile (iOS + Android) via Capacitor

Both web apps ship to the App Store and Play Store as **Capacitor** native
shells wrapping the built PWA. The web bundle (`dist/`) is packaged inside the
app; API calls go to the remote backend at `https://api.bookplus.pro`.

| App | Directory | Bundle ID | Store name |
|-----|-----------|-----------|------------|
| Customer | `apps/customer` | `pro.bookplus.customer` | Bookplus |
| Business | `apps/business` | `pro.bookplus.business` | Bookplus for Business |

Capacitor config lives in each app's `capacitor.config.ts`. Native-only setup
(status bar, splash, Android back button) is in `src/native.js`, called from
`main.jsx` and a **no-op in the browser**, so the web builds are unaffected.

The native projects (`android/`, `ios/`) are **generated** and git-ignored —
regenerate them with the commands below. Once signing is set up, a team may
decide to commit them.

---

## One-time setup (per app)

```bash
# from the repo root
pnpm install

# build the web bundle against the PROD API and generate/refresh native code
cd apps/customer         # or apps/business
pnpm mobile:build        # = VITE_API_URL=https://api.bookplus.pro vite build && cap sync

# add the native platforms (ios needs macOS)
npx cap add android
npx cap add ios          # macOS + Xcode + CocoaPods only
```

After any web change: `pnpm mobile:build` (rebuilds `dist/` and `cap sync`s it
into the native projects).

---

## Run on Android (emulator or device)

Requires the Android SDK + a device/emulator and a JDK (17+).

```bash
cd apps/customer
pnpm mobile:build
npx cap run android              # pick your emulator/device when prompted
# or open in Android Studio and press Run:
npx cap open android
```

**Known gotcha — "Unable to establish loopback connection" from Gradle.**
On some locked-down Windows machines (Hyper-V virtual adapters + endpoint
security) the Gradle *daemon* can't complete its loopback handshake, even
though plain sockets work. If `./gradlew` fails this way:
- Prefer **Android Studio** (`npx cap open android`) — it manages the daemon
  differently and usually succeeds.
- Or build on a machine / CI runner without that restriction (Linux/macOS are
  reliable), or a cloud build (EAS-style / GitHub Actions with an Android runner).
- IPv4 pinning (`systemProp.java.net.preferIPv4Stack=true` in
  `android/gradle.properties`) can help on some setups but not all.

---

## Run on iOS (macOS only)

```bash
cd apps/customer
pnpm mobile:build
npx cap add ios          # first time
npx cap open ios         # opens Xcode → set Team/signing → Run on a simulator
```

---

## What still has to be done before store submission

These are tracked separately; the Capacitor shell is the foundation, not the
finish line.

1. **App icons & splash screens** at native sizes. We have PWA icons
   (192/512 + maskable, apple-touch) in each app's `public/`; generate the
   native icon/splash sets with `@capacitor/assets`
   (`npx @capacitor/assets generate`) from a 1024×1024 master.
2. **Sign in with Apple** — required by Apple because we offer Google login.
3. **Native push** — we have *web* push (VAPID, off in prod). Native needs
   **APNs (iOS)** + **FCM (Android)** via `@capacitor/push-notifications`, and
   the backend `pushService` must send to device tokens.
4. **Session in the webview** — the SSO refresh cookie (`bp_rt`) is a
   cross-site cookie to `api.bookplus.pro`; SameSite=Lax cookies are **not**
   sent from the `capacitor://localhost` / `https://localhost` webview origin.
   The app must persist the session via the **localStorage refresh token**
   path, not the cookie. Validate login + token refresh on a real device and
   adjust `packages/api-client` if refresh relies on the cookie.
   > The API already allows the native origins in CORS (`server.js`).
5. **`/.well-known/assetlinks.json`** (Android App Links) and
   **`apple-app-site-association`** (iOS Universal Links) served from each
   web domain, with the real signing SHA-256 fingerprint / Apple Team ID.
6. **Account deletion** reachable in-app (exists via AccountDangerZone — keep
   it obvious). Required by both stores.
7. **Signing**: Android upload key + Play App Signing; iOS certs + provisioning.
8. **Store listings**: screenshots per device size, descriptions, privacy
   questionnaires (Apple App Privacy + Google Data Safety), age ratings.
9. **Payments framing** — the wallet must read as prepaying a real-world
   service (exempt from Apple IAP), not buying digital credit. Prepare review
   notes.

## Developer accounts (long lead time — start early)
- **Apple Developer Program** ($99/yr; company enrollment needs a D-U-N-S number).
- **Google Play Console** ($25 one-time; new personal accounts may require
  ~14-day closed testing before production).
