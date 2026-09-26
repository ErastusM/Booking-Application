/**
 * forceLogout / the refresh interceptor must never navigate away from a page
 * opened from an emailed one-time link. A dead session on the device (owner's
 * phone, shop tablet, re-invited member) used to bounce the invitee from
 * /accept-invite to a bare Sign In page ~0.2–0.65s after the form appeared,
 * losing the invite token.
 *
 * Runs in plain Node with a minimal fake window: jsdom's window.location is
 * unforgeable, so its navigation could not be observed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createHttp, forceLogout, isPublicTokenPath, PUBLIC_TOKEN_PATHS } from './http';

type FakeWin = { location: { pathname: string; search: string; href: string }; dispatchEvent: ReturnType<typeof vi.fn> };
let win: FakeWin;
let store: Map<string, string>;

const at = (pathname: string, search = '') => {
    win.location.pathname = pathname;
    win.location.search = search;
    win.location.href = `http://biz.test${pathname}${search}`;
};

beforeEach(() => {
    store = new Map([['token', 'stale-access'], ['refreshToken', 'stale-refresh']]);
    win = { location: { pathname: '/', search: '', href: '' }, dispatchEvent: vi.fn() };
    vi.stubGlobal('window', win);
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
    });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const dispatched = () => win.dispatchEvent.mock.calls.map((c) => (c[0] as Event).type);

describe('isPublicTokenPath', () => {
    it('matches the emailed-link pages exactly (and a trailing slash)', () => {
        expect(PUBLIC_TOKEN_PATHS).toEqual(['/accept-invite', '/reset-password', '/verify-email', '/unsubscribe/']);
        expect(isPublicTokenPath('/accept-invite')).toBe(true);
        expect(isPublicTokenPath('/accept-invite/')).toBe(true);
        expect(isPublicTokenPath('/reset-password')).toBe(true);
        expect(isPublicTokenPath('/verify-email')).toBe(true);
        expect(isPublicTokenPath('/accept-invite-lookalike')).toBe(false);
        expect(isPublicTokenPath('/dashboard')).toBe(false);
    });

    it('treats an entry ending in "/" as a prefix (the unsubscribe link carries its token in the path)', () => {
        expect(isPublicTokenPath('/unsubscribe/abc.def')).toBe(true);
        expect(isPublicTokenPath('/unsubscribe')).toBe(false);
        expect(isPublicTokenPath('/unsubscribed-lookalike')).toBe(false);
    });
});

describe('forceLogout', () => {
    it('does nothing at all on /auth/callback (the callback owns the session)', () => {
        at('/auth/callback', '?code=abc');
        const before = win.location.href;
        forceLogout();
        expect(store.get('token')).toBe('stale-access');
        expect(dispatched()).toEqual([]);
        expect(win.location.href).toBe(before);
    });

    it.each(['/accept-invite', '/reset-password', '/verify-email'])(
        'on %s: clears the dead session but never navigates',
        (path) => {
            at(path, '?token=RAW');
            const before = win.location.href;
            forceLogout();
            expect(store.has('token')).toBe(false);
            expect(store.has('refreshToken')).toBe(false);
            expect(dispatched()).toEqual(['auth-logout']);
            expect(win.location.href).toBe(before);
        },
    );

    it('elsewhere: goes to login with session_expired and the page to come back to', () => {
        at('/team', '?member=42');
        forceLogout();
        expect(store.has('token')).toBe(false);
        expect(dispatched()).toEqual(['auth-logout']);
        expect(win.location.href).toBe('/login?error=session_expired&next=%2Fteam%3Fmember%3D42');
    });

    it('from the root: no next', () => {
        at('/');
        forceLogout();
        expect(win.location.href).toBe('/login?error=session_expired');
    });

    it('already on /login: clears but stays', () => {
        at('/login', '?email=a%40b.c');
        const before = win.location.href;
        forceLogout();
        expect(store.has('token')).toBe(false);
        expect(win.location.href).toBe(before);
    });

    it('honours an overridden list of token paths', () => {
        at('/claim-gift', '?token=x');
        const before = win.location.href;
        forceLogout(['/claim-gift']);
        expect(win.location.href).toBe(before);

        at('/accept-invite', '?token=x');
        forceLogout(['/claim-gift']);
        expect(win.location.href).toBe('/login?error=session_expired&next=%2Faccept-invite%3Ftoken%3Dx');
    });
});

describe('refresh interceptor with a dead session', () => {
    // Every API call 401s and the silent refresh 401s too (revoked tokens).
    const deadSessionClient = (paths?: string[]) => {
        const api = createHttp('http://api.test', 'business', paths);
        api.defaults.adapter = async (config) => {
            const err: any = new Error('401');
            err.config = config;
            err.response = { status: 401, data: {}, headers: {}, config };
            throw err;
        };
        vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('401'), { response: { status: 401 } }));
        return api;
    };

    it('on /accept-invite the invitee stays on the page', async () => {
        at('/accept-invite', '?token=RAW');
        const before = win.location.href;
        const api = deadSessionClient();
        await expect(api.get('/auth/profile')).rejects.toBeTruthy();
        expect(axios.post).toHaveBeenCalledTimes(1);   // one refresh attempt
        expect(store.has('token')).toBe(false);
        expect(dispatched()).toEqual(['auth-logout']);
        expect(win.location.href).toBe(before);
    });

    it('on an app page it still signs out to login with next', async () => {
        at('/dashboard', '?tab=calendar');
        const api = deadSessionClient();
        await expect(api.get('/notifications')).rejects.toBeTruthy();
        expect(win.location.href).toBe('/login?error=session_expired&next=%2Fdashboard%3Ftab%3Dcalendar');
    });

    it('a transient refresh failure (5xx) keeps the session and never navigates', async () => {
        at('/dashboard');
        const before = win.location.href;
        const api = createHttp('http://api.test', 'business');
        api.defaults.adapter = async (config) => {
            const err: any = new Error('401');
            err.config = config;
            err.response = { status: 401, data: {}, headers: {}, config };
            throw err;
        };
        vi.spyOn(axios, 'post').mockRejectedValue(Object.assign(new Error('503'), { response: { status: 503 } }));
        await expect(api.get('/auth/profile')).rejects.toBeTruthy();
        expect(store.get('token')).toBe('stale-access');
        expect(win.location.href).toBe(before);
    });
});
