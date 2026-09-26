// Frontend crash reporting. Uncaught errors, unhandled promise rejections and
// React render crashes are POSTed to the API's /api/client-errors sink so
// production JS failures stop being invisible. Best-effort and defensive: it
// never throws, dedupes within a short window, and caps sends per session so a
// runaway loop can't spam. Only active in production builds (dev has the console).
//
// Nothing secret leaves the browser: the page URL of a reset, invite, verify,
// OAuth-callback or /manage/<token> screen IS the credential, so the URL, the
// message and the stack are scrubbed (query values, fragments and token path
// segments → [redacted] / :token) before they are sent. The API scrubs again.
import { scrubUrl, scrubText } from '@bookplus/api-client';
const APP_NAME = 'customer';
const ENDPOINT = `${import.meta.env.VITE_API_URL || ''}/api/client-errors`;
const MAX_PER_SESSION = 20;
const WINDOW_MS = 10000;

const recent = new Map(); // signature -> timestamp
let sentThisSession = 0;

const post = (payload) => {
    if (!import.meta.env.PROD) return; // don't report from local dev
    if (sentThisSession >= MAX_PER_SESSION) return;

    const now = Date.now();
    for (const [k, t] of recent) if (now - t > WINDOW_MS) recent.delete(k);
    const sig = `${payload.type}:${payload.message}`.slice(0, 200);
    if (recent.has(sig)) return;
    recent.set(sig, now);
    sentThisSession += 1;

    try {
        fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                app: APP_NAME,
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                ...payload,
                url: typeof location !== 'undefined' ? scrubUrl(location.href) : '',
                message: scrubText(String(payload.message || '')),
                stack: scrubText(String(payload.stack || '')),
            }),
            keepalive: true, // allow the send to complete even during unload
        }).catch(() => {});
    } catch {
        /* reporting must never itself throw */
    }
};

// Called by the ErrorBoundary and anywhere we catch-and-swallow deliberately.
export const reportError = (error, type = 'render') => {
    post({ type, message: error?.message || String(error), stack: error?.stack || '' });
};

export const initErrorReporter = () => {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => {
        post({
            type: 'uncaught',
            message: e.message || 'Script error',
            stack: e.error?.stack || `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`,
        });
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        post({ type: 'unhandledrejection', message: r?.message || String(r), stack: r?.stack || '' });
    });
};
