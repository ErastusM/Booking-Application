// One-time sign-in codes (Google sign-in, the switch between the customer and
// business apps) travel in a link. Bound to the browser that asked for them, a
// copied or shared link can't sign someone else in: minting sets a short-lived
// httpOnly cookie, and the exchange only accepts the code from a browser that
// carries the same cookie.
const crypto = require('crypto');

const HANDOFF_COOKIE = 'bp_ho';
const TTL_SECONDS = 10 * 60; // the code itself expires after 10 minutes

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

const cookieAttrs = () => {
    const parts = ['HttpOnly', 'Path=/api/auth', 'SameSite=Lax'];
    if (process.env.COOKIE_DOMAIN) parts.push(`Domain=${process.env.COOKIE_DOMAIN}`);
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts;
};

/** Set the browser's binding cookie; returns the hash to store with the code. */
const bindHandoff = (res) => {
    const nonce = crypto.randomBytes(24).toString('hex');
    res.append('Set-Cookie', [`${HANDOFF_COOKIE}=${nonce}`, `Max-Age=${TTL_SECONDS}`, ...cookieAttrs()].join('; '));
    return sha256(nonce);
};

const clearHandoff = (res) => {
    res.append('Set-Cookie', [`${HANDOFF_COOKIE}=`, 'Max-Age=0', ...cookieAttrs()].join('; '));
};

const readNonce = (req) => {
    const match = (req.headers.cookie || '').match(/(?:^|;\s*)bp_ho=([^;]+)/);
    return match ? match[1] : null;
};

/**
 * True when this request may use a code stored with `bindingHash`. A code
 * minted before binding existed has no hash and is accepted (it expires within
 * 10 minutes of the deploy anyway).
 */
const handoffAllowed = (req, bindingHash) => {
    if (!bindingHash) return true;
    const nonce = readNonce(req);
    if (!nonce) return false;
    const a = Buffer.from(sha256(nonce));
    const b = Buffer.from(String(bindingHash));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

module.exports = { HANDOFF_COOKIE, bindHandoff, clearHandoff, handoffAllowed };
