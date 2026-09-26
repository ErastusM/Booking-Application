/**
 * Cookie / analytics consent (compliance audit points 5 and 6).
 *   - nothing is tracked, sent or stored (no bp_sid) before "Accept analytics";
 *   - after it, events flow with a persistent bp_sid;
 *   - withdrawing ("Only necessary") drops the queue and deletes bp_sid;
 *   - every storage key the code uses is listed in BOTH apps' cookies.json.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    createTelemetry, setConsent, getConsent, hasAnalyticsConsent, CONSENT_KEY, ANALYTICS_ID_KEY,
} from '@bookplus/api-client';

const fakeApi = () => ({ post: vi.fn(() => Promise.resolve({})) });

beforeEach(() => { localStorage.clear(); });

describe('consent storage', () => {
    it('starts with no choice, records one with a timestamp', () => {
        expect(getConsent()).toBeNull();
        const c = setConsent(true);
        expect(c.analytics).toBe(true);
        expect(new Date(c.at).toString()).not.toBe('Invalid Date');
        expect(JSON.parse(localStorage.getItem(CONSENT_KEY)).analytics).toBe(true);
        expect(hasAnalyticsConsent()).toBe(true);
    });
});

describe('telemetry is consent-gated', () => {
    it('sends nothing and creates no id before consent', () => {
        const api = fakeApi();
        const t = createTelemetry(api, 'http://api.test', 'business');
        t.track('page_view');
        t.flush();
        expect(api.post).not.toHaveBeenCalled();
        expect(localStorage.getItem(ANALYTICS_ID_KEY)).toBeNull();
    });

    it('sends nothing after "Only necessary"', () => {
        setConsent(false);
        const api = fakeApi();
        const t = createTelemetry(api, 'http://api.test', 'business');
        t.track('page_view');
        t.flush();
        expect(api.post).not.toHaveBeenCalled();
        expect(localStorage.getItem(ANALYTICS_ID_KEY)).toBeNull();
    });

    it('tracks after "Accept analytics", with route templates only', () => {
        setConsent(true);
        window.history.replaceState({}, '', '/manage/0b8a3c1e-2f4d-4c6a-9e7b-1a2b3c4d5e6f?token=abc');
        const api = fakeApi();
        const t = createTelemetry(api, 'http://api.test', 'business');
        t.track('page_view');
        t.flush();
        expect(api.post).toHaveBeenCalledTimes(1);
        const [, body] = api.post.mock.calls[0];
        expect(body.sessionId).toBe(localStorage.getItem(ANALYTICS_ID_KEY));
        expect(body.sessionId).toBeTruthy();
        expect(body.events[0].path).toBe('/manage/:token');
        window.history.replaceState({}, '', '/');
    });

    it('withdrawing consent deletes bp_sid and drops anything queued', () => {
        setConsent(true);
        const api = fakeApi();
        const t = createTelemetry(api, 'http://api.test', 'business');
        t.track('page_view'); // queued (flush is on a timer)
        t.flush();
        expect(localStorage.getItem(ANALYTICS_ID_KEY)).toBeTruthy();
        api.post.mockClear();
        t.track('provider_view');
        setConsent(false);
        t.flush();
        expect(api.post).not.toHaveBeenCalled();
        expect(localStorage.getItem(ANALYTICS_ID_KEY)).toBeNull();
    });
});

describe('cookies.json covers every storage key in the code', () => {
    const root = path.resolve(__dirname, '../../../..');
    const walk = (dir, out = []) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p, out);
            else if (/\.(jsx?|tsx?|html)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
        }
        return out;
    };
    const keysIn = (dirs) => {
        const keys = new Set();
        for (const d of dirs) {
            for (const f of walk(d)) {
                const src = fs.readFileSync(f, 'utf8');
                for (const m of src.matchAll(/(?:local|session)Storage\.(?:get|set|remove)Item\(\s*['"`]([^'"`]+)['"`]/g)) keys.add(m[1]);
                for (const m of src.matchAll(/const\s+\w*KEY\w*\s*=\s*['"`](bp_[^'"`]+)['"`]/g)) keys.add(m[1]);
            }
        }
        return keys;
    };

    for (const app of ['customer', 'business']) {
        it(`${app}: every key is classified`, () => {
            const json = JSON.parse(fs.readFileSync(path.join(root, `apps/${app}/src/legal/cookies.json`), 'utf8'));
            const listed = new Set(json.items.map((i) => i.key));
            const used = keysIn([path.join(root, `apps/${app}/src`), path.join(root, `apps/${app}/index.html`).replace(/index\.html$/, ''), path.join(root, 'packages/api-client/src')]);
            const missing = [...used].filter((k) => !listed.has(k));
            expect(missing).toEqual([]);
            for (const i of json.items) expect(['necessary', 'analytics']).toContain(i.category);
            expect(json.items.find((i) => i.key === 'bp_sid').category).toBe('analytics');
        });
    }
});
