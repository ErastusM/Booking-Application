// Cookie / tracking consent (compliance audit points 5 and 6), shared by both apps.
//
// Bookplus sets no third-party trackers. The one non-essential thing is its own
// first-party product analytics (telemetry.ts): a persistent random id (bp_sid)
// plus page-view / funnel events. That runs ONLY after the visitor taps
// "Accept analytics". Before a choice — or after "Only necessary" — nothing is
// sent and no id exists. Withdrawing consent deletes bp_sid.
//
// The choice is stored on this device (localStorage "bp_consent") with the time
// it was made, and can be changed any time from "Cookie settings" (footer /
// account), which calls openConsentSettings(). Every key the apps store is
// listed and classified in apps/<app>/src/legal/cookies.json.

/** Minimum age to create an account (mirrors apps/api/src/constants/consent.js,
 *  which the API enforces). */
export const MIN_SIGNUP_AGE = 16;

export const CONSENT_KEY = 'bp_consent';
export const ANALYTICS_ID_KEY = 'bp_sid';
export const CONSENT_VERSION = 1;
export const CONSENT_CHANGE_EVENT = 'bp:consent-change';
export const CONSENT_OPEN_EVENT = 'bp:consent-open';

export interface ConsentChoice {
    v: number;
    analytics: boolean;
    at: string; // ISO time the choice was made
}

const storage = (): Storage | null => {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
};

/** The stored choice, or null if the visitor has not chosen yet (or it is from an older version). */
export function getConsent(): ConsentChoice | null {
    try {
        const raw = storage()?.getItem(CONSENT_KEY);
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (!c || c.v !== CONSENT_VERSION || typeof c.analytics !== 'boolean') return null;
        return c;
    } catch {
        return null;
    }
}

export const hasAnalyticsConsent = (): boolean => getConsent()?.analytics === true;

/** Record a choice ("Only necessary" = false, "Accept analytics" = true). */
export function setConsent(analytics: boolean): ConsentChoice {
    const choice: ConsentChoice = { v: CONSENT_VERSION, analytics: !!analytics, at: new Date().toISOString() };
    const s = storage();
    try {
        s?.setItem(CONSENT_KEY, JSON.stringify(choice));
        // Withdrawn (or never given): the permanent analytics id must not survive.
        if (!choice.analytics) s?.removeItem(ANALYTICS_ID_KEY);
    } catch { /* storage blocked — the choice then lasts for this page only */ }
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
    } catch { /* ignore */ }
    return choice;
}

/** Ask the app's cookie banner to open (the "Cookie settings" link). */
export function openConsentSettings(): void {
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
    } catch { /* ignore */ }
}

/** Subscribe to consent changes; returns an unsubscribe function. */
export function onConsentChange(cb: (c: ConsentChoice) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const h = (e: Event) => cb((e as CustomEvent).detail);
    window.addEventListener(CONSENT_CHANGE_EVENT, h);
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, h);
}
