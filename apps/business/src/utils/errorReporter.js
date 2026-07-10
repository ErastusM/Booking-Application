// Frontend crash reporting. Uncaught errors, unhandled promise rejections and
// React render crashes are POSTed to the API's /api/client-errors sink so
// production JS failures stop being invisible. Best-effort and defensive: it
// never throws, dedupes within a short window, and caps sends per session so a
// runaway loop can't spam. Only active in production builds (dev has the console).
const APP_NAME = 'business';
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
                url: typeof location !== 'undefined' ? location.href : '',
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                ...payload,
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
