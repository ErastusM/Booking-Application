const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Rate limits for /api/auth, split by what the request does.
 *
 * It used to be ONE per-IP bucket of 50 requests / 15 min over every /api/auth
 * route — including the calls the apps make on their own on every load and
 * page change (GET /profile, POST /refresh, GET /sibling …). Everyone behind a
 * shared public IP — a salon's Wi-Fi, a mobile network's carrier-grade NAT —
 * drew from that one bucket, so ordinary use could lock them all out of
 * logging in ("Too many requests") for 15 minutes.
 *
 *   credential routes (a password or token is tried): strict, keyed on the IP
 *     AND the email tried, so one person hammering an account can't lock out
 *     their neighbours; plus a looser per-IP cap against spraying many accounts.
 *   session routes (profile, refresh, sibling, block list …): a generous per-IP
 *     budget sized for normal use by several people on one connection.
 */
const CREDENTIAL_PATHS = new Set([
    '/login', '/register', '/forgot-password', '/reset-password', '/resend-verification',
    '/exchange-code', '/change-password', '/deactivate', '/account', '/verify-email',
]);
const isCredentialRequest = (req) => CREDENTIAL_PATHS.has(req.path)
    || req.path.startsWith('/google')
    || (req.method === 'POST' && /^\/staff-invite\/[^/]+\/(accept|renew)$/.test(req.path))
    || (req.method === 'POST' && req.path === '/staff-invite/request');

const createAuthRouteLimiter = ({ enabled = true, credentialMax = 20, credentialIpMax = 200, sessionMax = 600, windowMs = 15 * 60 * 1000 } = {}) => {
    const common = {
        windowMs,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: 'Too many requests, please try again later.' },
        skip: () => !enabled,
    };
    const credentialLimiter = rateLimit({
        ...common,
        max: credentialMax,
        keyGenerator: (req) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            return `${ipKeyGenerator(req.ip)}|${email}`;
        },
    });
    const credentialIpLimiter = rateLimit({ ...common, max: credentialIpMax });
    const sessionLimiter = rateLimit({ ...common, max: sessionMax });
    return (req, res, next) => (isCredentialRequest(req)
        ? credentialIpLimiter(req, res, (err) => (err ? next(err) : credentialLimiter(req, res, next)))
        : sessionLimiter(req, res, next));
};

module.exports = { createAuthRouteLimiter, isCredentialRequest };
