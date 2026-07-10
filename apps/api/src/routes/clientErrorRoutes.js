const express = require('express');
const rateLimit = require('express-rate-limit');
const pino = require('pino');
const { sendAlert } = require('../utils/alerts');

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const router = express.Router();

// Frontend crash reporting sink. Both apps POST uncaught errors, unhandled
// promise rejections and React render crashes here so production JS failures
// stop being invisible. Public (browsers have no token), so it is rate-limited
// hard and every field is length-capped before it touches a log or an alert.
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 30, // per IP per minute
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    // A flood of client errors should be dropped quietly, not answered with a
    // JSON error the failing page might then try to report again.
    handler: (req, res) => res.status(429).end(),
});

// De-duplicate identical errors so one broken component can't page the on-call
// channel hundreds of times. Alert once per (app+message+top-of-stack) per window.
const WINDOW_MS = 5 * 60 * 1000;
const seen = new Map();
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

// This content is attacker-controllable (the endpoint is public) and gets posted
// to the Slack/Discord alert webhook, which renders mrkdwn. Neutralize the chars
// that trigger channel/here pings and link syntax so a crafted error can't spoof
// or @-ping the ops channel: drop < >, and break @ / & mentions with a zero-width
// space (keeps the text readable in the alert).
const ZWSP = String.fromCharCode(0x200b);
const neutralize = (s) => String(s).replace(/[<>]/g, '').replace(/[@&]/g, (c) => c + ZWSP);
const shouldAlert = (key) => {
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k);
    if (seen.has(key)) return false;
    seen.set(key, now);
    return true;
};

router.post('/', limiter, (req, res) => {
    // Always ack fast — the browser must never block or retry on our behalf.
    res.status(204).end();

    try {
        const b = req.body || {};
        const app = clip(b.app, 20) || 'unknown';
        const type = clip(b.type, 30) || 'error';
        const message = clip(b.message, 500) || '(no message)';
        const stack = clip(b.stack, 2000);
        const url = clip(b.url, 300);
        const userAgent = clip(b.userAgent || req.get('user-agent'), 300);

        logger.error({ clientError: true, app, type, message, url, userAgent, stack }, `client error [${app}]: ${message}`);

        const key = `${app}:${message}:${stack.slice(0, 120)}`;
        if (shouldAlert(key)) {
            // Sanitize the (public, attacker-controllable) fields before they hit the webhook.
            const detail = neutralize(`${type}: ${message}\n${url}\n${stack.split('\n').slice(0, 4).join('\n')}`);
            sendAlert(`Client error (${app})`, detail).catch(() => {});
        }
    } catch (err) {
        logger.warn({ err: err.message }, 'client-error ingest failed (non-fatal)');
    }
});

// Test hook — the dedup map is module state.
router._resetSeen = () => seen.clear();

module.exports = router;
