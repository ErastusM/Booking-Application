/**
 * Sentry error monitoring — INERT unless SENTRY_DSN is set, so local dev, CI,
 * and any deploy without the key run byte-for-byte as before. When a DSN is
 * present, uncaught errors, unhandled rejections, and errors thrown from route
 * handlers are captured with a stack trace, request context, environment and
 * release tag, and forwarded to Sentry for aggregation + alerting.
 *
 * This complements (does not replace) utils/alerts.js: the webhook alerter still
 * fires a one-line Slack/Discord ping on a process-level crash; Sentry adds the
 * searchable, deduplicated, stack-trace-rich record behind it.
 *
 * MUST be require()'d after dotenv (so it can read SENTRY_DSN) but BEFORE express
 * and the app code — Sentry v8 auto-instruments http/express at require time.
 */
const Sentry = require('@sentry/node');
const { scrubUrl, scrubText } = require('./src/utils/redact');

/**
 * Last line of defence before an event leaves the process. Sentry records the
 * request URL + query string, breadcrumbs of outgoing/incoming HTTP calls and the
 * transaction name — any of which can carry a reset/invite/verify token, an OAuth
 * code or a guest /manage/<token>. Scrub them all (same rules as the logs).
 * Exported for tests.
 */
const scrubEvent = (event) => {
    try {
        if (!event || typeof event !== 'object') return event;
        if (event.request) {
            if (event.request.url) event.request.url = scrubUrl(event.request.url);
            if (event.request.query_string) event.request.query_string = '[redacted]';
            if (event.request.cookies) event.request.cookies = '[redacted]';
            if (event.request.headers) {
                for (const h of Object.keys(event.request.headers)) {
                    if (/^(authorization|cookie|referer)$/i.test(h)) event.request.headers[h] = '[redacted]';
                }
            }
        }
        if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction);
        if (typeof event.message === 'string') event.message = scrubText(event.message);
        if (event.extra && typeof event.extra === 'object') {
            for (const k of Object.keys(event.extra)) {
                if (typeof event.extra[k] === 'string') event.extra[k] = scrubText(event.extra[k]);
            }
        }
        for (const ex of (event.exception && event.exception.values) || []) {
            if (typeof ex.value === 'string') ex.value = scrubText(ex.value);
        }
        for (const b of event.breadcrumbs || []) {
            if (typeof b.message === 'string') b.message = scrubText(b.message);
            if (b.data && typeof b.data.url === 'string') b.data.url = scrubUrl(b.data.url);
            if (b.data && typeof b.data['http.query'] === 'string') b.data['http.query'] = '[redacted]';
        }
    } catch { /* scrubbing must never drop the report */ }
    return event;
};

const dsn = process.env.SENTRY_DSN;
if (dsn) {
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        // The deploy stamps a release (e.g. the image tag / git sha) so errors are
        // attributed to a version and regressions are visible across deploys.
        release: process.env.SENTRY_RELEASE || undefined,
        // Errors are the goal; performance tracing is off by default (it has real
        // cost). A deploy can opt in with SENTRY_TRACES_SAMPLE_RATE=0.1 etc.
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0,
        // Never attach cookies / auth headers / request bodies by default — the
        // API handles credentials and personal data. Opt in explicitly if ever needed.
        sendDefaultPii: false,
        beforeSend: scrubEvent,
        beforeSendTransaction: scrubEvent,
        beforeBreadcrumb: (crumb) => {
            try {
                if (crumb && crumb.data && typeof crumb.data.url === 'string') crumb.data.url = scrubUrl(crumb.data.url);
                if (crumb && typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
            } catch { /* keep the crumb */ }
            return crumb;
        },
        // Sentry still CAPTURES an uncaught exception, but must not own the exit:
        // server.js's own handler alerts the ops webhook and flushes Sentry before
        // a clean process.exit(1) (→ container restart). Letting Sentry force-exit
        // would pre-empt that webhook ping.
        integrations: [
            Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: false }),
        ],
    });
}

// Whether monitoring is actually active (a DSN was provided). Callers can use
// this to avoid setting up Sentry-only middleware when it's inert.
Sentry.isEnabled = () => Boolean(dsn);
Sentry.scrubEvent = scrubEvent;

module.exports = Sentry;
