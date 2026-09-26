import { AxiosInstance } from 'axios';
import { routeTemplate } from './redact';
import { ANALYTICS_ID_KEY, hasAnalyticsConsent, onConsentChange } from './consent';

// Tiny client-side product-analytics buffer. track(name, props) queues an event;
// the queue flushes to POST /api/events on an interval, when it fills, and on tab
// hide/close (via sendBeacon so the last events survive navigation). Anonymous
// per-tab sessionId stitches the funnel; a logged-in flush is attributed to the
// user server-side. Fire-and-forget everywhere — analytics must never break UX.
//
// CONSENT-GATED (consent.ts): nothing is queued, sent or stored — not even the
// bp_sid id — until the visitor taps "Accept analytics". Withdrawing consent
// drops anything queued and deletes bp_sid.

type Props = Record<string, unknown>;
interface QueuedEvent { name: string; props?: Props; path?: string; t: number }

export interface Telemetry {
    track: (name: string, props?: Props) => void;
    flush: () => void;
}

const SID_KEY = ANALYTICS_ID_KEY;
const MAX_BATCH = 15;
const FLUSH_MS = 12000;

const noop: Telemetry = { track: () => {}, flush: () => {} };

function sessionId(): string {
    if (!hasAnalyticsConsent()) return 'anon';
    try {
        const existing = localStorage.getItem(SID_KEY);
        if (existing) return existing;
        const c: any = typeof crypto !== 'undefined' ? crypto : null;
        const sid: string = (c && c.randomUUID)
            ? c.randomUUID()
            : `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
        localStorage.setItem(SID_KEY, sid);
        return sid;
    } catch {
        return 'anon';
    }
}

export function createTelemetry(api: AxiosInstance, apiBase: string, app: 'customer' | 'business'): Telemetry {
    if (typeof window === 'undefined' || typeof document === 'undefined') return noop;

    let queue: QueuedEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beaconUrl = `${apiBase.replace(/\/$/, '')}/api/events`;

    const beacon = (events: QueuedEvent[]): boolean => {
        try {
            const body = JSON.stringify({ app, sessionId: sessionId(), events });
            // keepalive fetch — NOT sendBeacon. In prod the API is a different origin
            // (api.bookplus.pro), and a sendBeacon with an application/json body is
            // non-CORS-safelisted, so the browser blocks it and the tab-close flush is
            // lost. keepalive fetch performs the CORS preflight sendBeacon can't AND
            // survives page unload (matches the crash-reporter). Attribute to the user
            // when we have a token, since fetch (unlike sendBeacon) can set headers.
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            try {
                const token = localStorage.getItem('token');
                if (token) headers.Authorization = `Bearer ${token}`;
            } catch { /* ignore */ }
            fetch(beaconUrl, { method: 'POST', headers, body, keepalive: true }).catch(() => {});
            return true;
        } catch {
            return false;
        }
    };

    const flush = (useBeacon = false) => {
        if (!queue.length) return;
        if (!hasAnalyticsConsent()) { queue = []; return; }
        const events = queue;
        queue = [];
        if (timer) { clearTimeout(timer); timer = null; }
        if (useBeacon && beacon(events)) return;
        // Authenticated flush via axios (attaches the user server-side); dropped on failure.
        api.post('/events', { app, sessionId: sessionId(), events }).catch(() => {});
    };

    const schedule = () => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
    };

    const track = (name: string, props?: Props) => {
        if (!name) return;
        if (!hasAnalyticsConsent()) return; // no consent → no event, no id
        try {
            // Route template only (/manage/:token), never the raw path or query:
            // a guest's manage link IS their booking credential.
            queue.push({ name: String(name).slice(0, 60), props, path: routeTemplate(location.pathname), t: Date.now() });
            if (queue.length >= MAX_BATCH) flush();
            else schedule();
        } catch {
            /* never throw from tracking */
        }
    };

    // Consent withdrawn: forget what is queued (consent.ts already deleted bp_sid).
    onConsentChange((c) => {
        if (c && c.analytics) return;
        queue = [];
        if (timer) { clearTimeout(timer); timer = null; }
    });

    // Beacon-flush when the tab is hidden or unloaded so trailing events aren't lost.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush(true);
    });
    window.addEventListener('pagehide', () => flush(true));

    return { track, flush: () => flush(false) };
}
