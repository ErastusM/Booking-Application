const jwt = require('jsonwebtoken');

exports.generateToken = (id, tokenVersion = 0) => {
    // 15 minutes by default: access tokens are role-blind (the middleware never
    // checks accountType), so a long-lived one held by the wrong app stays
    // usable for its whole life. Sessions still feel week-long — the refresh
    // interceptor renews silently — but a stray token now dies in minutes, not
    // days. Never issue a token with no expiry (jwt.sign treats expiresIn:
    // undefined as forever); tokenVersion still revokes instantly on
    // logout/password change. Deployments can widen via JWT_EXPIRE.
    return jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '15m'
    });
};

exports.generateRefreshToken = (id, tokenVersion = 0, jti) => {
    const payload = { id, tokenVersion };
    if (jti) payload.jti = jti; // token id, tracked per-user for rotation / reuse rejection
    return jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET, {
        expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '30d'
    });
};

exports.formatResponse = (success, message, data = null, statusCode = 200) => {
    return {
        success,
        message,
        data,
        statusCode
    };
};

// Linear-time only — see the note on User.email. The old pattern here was the
// same catastrophically-backtracking regex; it had no runtime caller, but it is
// exactly the sort of helper that gets picked up later, so it is fixed too.
exports.validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
};

// Accept a URL only if it is plainly http(s), else store nothing. Payment-proof
// links are submitted by customers and then shown as a clickable link to a
// PROVIDER and to ADMINS, so an unvalidated value hands a lower-privileged user
// a way to put `javascript:`/`data:` or a phishing target in front of a
// higher-privileged one inside our own trusted UI.
exports.safeHttpUrl = (value) => {
    const raw = (value == null ? '' : String(value)).trim().slice(0, 500);
    if (!raw) return '';
    try {
        const u = new URL(raw);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : '';
    } catch {
        return ''; // not an absolute URL at all
    }
};

// A Web Push endpoint only ever points at a browser vendor's push service.
// The server later POSTs to whatever we store (pushService.sendToUser), so an
// unvalidated, client-supplied endpoint is a blind-SSRF primitive (an internal
// URL like http://169.254.169.254/… would be fetched from the API's network).
// Pin it to https + a known push-provider host before it is ever persisted;
// the provider set is small and stable (every major browser routes through one
// of these). Returns the normalised URL string, or '' if it isn't a real,
// https push endpoint.
const PUSH_ENDPOINT_HOSTS = [
    'fcm.googleapis.com',                 // Chrome / Chromium / Edge / Opera / Android
    'web.push.apple.com',                 // Safari / WebKit
    'updates.push.services.mozilla.com',  // Firefox
    'notify.windows.com',                 // legacy EdgeHTML / WNS (regional subdomains)
    'push.microsoft.com',                 // WNS (subdomains)
];
exports.safePushEndpoint = (value) => {
    const raw = (value == null ? '' : String(value)).trim().slice(0, 1000);
    if (!raw) return '';
    let u;
    try { u = new URL(raw); } catch { return ''; }
    if (u.protocol !== 'https:') return '';
    const host = u.hostname.toLowerCase();
    const ok = PUSH_ENDPOINT_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
    return ok ? u.toString() : '';
};
