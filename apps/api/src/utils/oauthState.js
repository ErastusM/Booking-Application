/**
 * OAuth `state` CSRF protection for the Google sign-in flow.
 *
 * The `state` parameter was previously used ONLY to carry the chosen role, and was
 * never verified on the way back. passport-oauth2 installs a NullStore when the
 * strategy is built without `state`/`store`, and that store's verify() calls back
 * `true` unconditionally — so the callback accepted any authorization code from any
 * browser. That is login-CSRF: an attacker starts a Google flow, captures their own
 * code, and lures the victim to the callback, silently signing the victim into the
 * ATTACKER's account (audit #13).
 *
 * Fix: bind every flow to the browser that started it with a nonce.
 *   state  = "<role>.<nonce>"          (role still travels here; Google echoes it back)
 *   cookie = "<nonce>.<HMAC(nonce)>"   (HttpOnly, short-lived, scoped to /api/auth)
 * The callback only proceeds when the nonce echoed back matches the one in this
 * browser's cookie AND the HMAC verifies. An attacker cannot set a cookie in the
 * victim's browser for our origin, so a foreign code no longer completes.
 *
 * Implemented with raw Set-Cookie/Cookie headers on purpose: the API is otherwise
 * entirely cookie-free (JWT in headers), so this avoids adding cookie-parser and
 * keeps the surface to these two routes. SameSite=Lax is correct — the callback is
 * a top-level GET navigation from Google, which Lax permits.
 */
const crypto = require('crypto');

const COOKIE = 'bp_oauth_state';
const TTL_SECONDS = 600; // 10 minutes: an OAuth round-trip, not a session

const secret = () => process.env.JWT_SECRET || 'dev-oauth-state-secret';
const sign = (nonce) => crypto.createHmac('sha256', secret()).update(String(nonce)).digest('hex');

/** A fresh state string + the nonce to put in the cookie. */
const buildState = (role) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    return { state: `${role}.${nonce}`, nonce };
};

/**
 * The role carried in `state`. Only ever used to pick which app to redirect to —
 * never as an authorization decision — so parsing it from unverified input is safe.
 */
const roleFromState = (state) => (String(state || '').split('.')[0] === 'provider' ? 'provider' : 'customer');

const cookieHeader = (nonce) => {
    const parts = [
        `${COOKIE}=${nonce}.${sign(nonce)}`,
        'HttpOnly',
        'Path=/api/auth',
        `Max-Age=${TTL_SECONDS}`,
        'SameSite=Lax',
    ];
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts.join('; ');
};

const clearCookieHeader = () => `${COOKIE}=; HttpOnly; Path=/api/auth; Max-Age=0; SameSite=Lax`;

const readCookie = (req) => {
    const raw = req?.headers?.cookie || '';
    const hit = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
    return hit ? hit.slice(COOKIE.length + 1) : null;
};

/** True only when the returned state matches a nonce this browser was issued. */
const verifyState = (req) => {
    const nonce = String(req?.query?.state || '').split('.')[1];
    const cookie = readCookie(req);
    if (!nonce || !cookie) return false;
    const [cookieNonce, cookieSig] = cookie.split('.');
    if (!cookieNonce || !cookieSig || cookieNonce !== nonce) return false;
    const expected = sign(cookieNonce);
    const got = Buffer.from(cookieSig);
    const want = Buffer.from(expected);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
};

module.exports = { COOKIE, buildState, roleFromState, cookieHeader, clearCookieHeader, verifyState };
