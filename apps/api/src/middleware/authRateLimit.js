const crypto = require('crypto');
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
    || (req.method === 'POST' && /^\/staff-invite\/[^/]+\/accept$/.test(req.path));

// "Email me a new link" (POST /staff-invite/request, /staff-invite/:token/renew).
// These carry their OWN limiter (createInviteRequestLimiter, mounted on the two
// routes) and are kept out of every shared bucket here: on a salon's shared
// Wi-Fi, a few members asking for new links must never use up the allowance
// the next member needs to accept their invite.
const isInviteRequest = (req) => req.method === 'POST'
    && (req.path === '/staff-invite/request' || /^\/staff-invite\/[^/]+\/renew$/.test(req.path));

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
    return (req, res, next) => {
        if (isInviteRequest(req)) return next();
        return isCredentialRequest(req)
            ? credentialIpLimiter(req, res, (err) => (err ? next(err) : credentialLimiter(req, res, next)))
            : sessionLimiter(req, res, next);
    };
};

/**
 * Limiter for the invite "new link" endpoints only. Keyed on IP + the thing
 * asked about (the email, or a hash of the token), like the credential
 * limiter, so one person retrying can't block a colleague on the same
 * connection; plus a looser per-IP ceiling against sweeping many addresses.
 * Separate stores from every other limiter — it never consumes accept's (or
 * register's / forgot-password's) allowance. The per-account cooldown in
 * utils/staffInvites is what actually bounds emails sent.
 */
const createInviteRequestLimiter = ({ enabled = true, keyMax = 6, ipMax = 40, windowMs = 60 * 60 * 1000 } = {}) => {
    const message = { success: false, code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in a few minutes.' };
    const common = { windowMs, standardHeaders: true, legacyHeaders: false, message, skip: () => !enabled };
    const keyed = rateLimit({
        ...common,
        max: keyMax,
        keyGenerator: (req) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const token = req.params?.token || (req.path.match(/^\/staff-invite\/([^/]+)\/renew$/) || [])[1] || '';
            const subject = email || (token ? `t:${crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32)}` : '');
            return `${ipKeyGenerator(req.ip)}|${subject}`;
        },
    });
    const perIp = rateLimit({ ...common, max: ipMax });
    return (req, res, next) => perIp(req, res, (err) => (err ? next(err) : keyed(req, res, next)));
};

module.exports = { createAuthRouteLimiter, createInviteRequestLimiter, isCredentialRequest, isInviteRequest };
