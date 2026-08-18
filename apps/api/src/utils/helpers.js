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
