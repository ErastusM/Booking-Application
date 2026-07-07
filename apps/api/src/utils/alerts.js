/**
 * Zero-dependency error alerting: fire-and-forget POSTs to a webhook
 * (Slack/Discord/Mattermost-style `{ text }` payload). No-op unless
 * ALERT_WEBHOOK_URL is set, throttled so an error storm can't flood the
 * channel, and it never throws — alerting must not break the request path.
 */
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const WINDOW_MS = 5 * 60 * 1000;
const MAX_PER_WINDOW = 5;
let windowStart = 0;
let sentInWindow = 0;
let suppressed = 0;

const sendAlert = async (title, detail = '') => {
    const url = process.env.ALERT_WEBHOOK_URL;
    if (!url || process.env.NODE_ENV === 'test') return false;

    const now = Date.now();
    if (now - windowStart > WINDOW_MS) {
        if (suppressed > 0) detail = `${detail}\n(+${suppressed} similar alerts suppressed in the last window)`;
        windowStart = now;
        sentInWindow = 0;
        suppressed = 0;
    }
    if (sentInWindow >= MAX_PER_WINDOW) { suppressed += 1; return false; }
    sentInWindow += 1;

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `🔴 Bookplus API — ${title}\n${String(detail).slice(0, 600)}` }),
            // A hung webhook must never stall the caller — the crash handler
            // awaits this before process.exit.
            signal: AbortSignal.timeout(5000),
        });
        return true;
    } catch (err) {
        logger.warn({ err: err.message }, 'Alert webhook failed (non-fatal)');
        return false;
    }
};

// Test hook — the throttle is module state.
const _resetThrottle = () => { windowStart = 0; sentInWindow = 0; suppressed = 0; };

module.exports = { sendAlert, _resetThrottle };
