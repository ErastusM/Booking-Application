/**
 * OAuth state CSRF binding (#13). Covers the logic that decides whether a Google
 * callback is honoured — the part that can be verified without a real Google
 * round-trip. The end-to-end flow still needs a live sign-in smoke test.
 */
const { buildState, roleFromState, cookieHeader, clearCookieHeader, verifyState } = require('../../utils/oauthState');

// Rebuild the request shape the callback sees: ?state=... plus the Cookie header
// the browser echoes back from our Set-Cookie.
const reqFrom = (state, setCookieHeader) => ({
    query: { state },
    headers: setCookieHeader ? { cookie: setCookieHeader.split(';')[0] } : {},
});

describe('#13 — OAuth state binds the callback to the browser that started it', () => {
    it('accepts a callback whose state matches this browser’s cookie', () => {
        const { state, nonce } = buildState('customer');
        expect(verifyState(reqFrom(state, cookieHeader(nonce)))).toBe(true);
    });

    it('rejects an attacker’s state when the browser has no cookie (login CSRF)', () => {
        const { state } = buildState('customer'); // attacker-started flow
        expect(verifyState(reqFrom(state, null))).toBe(false); // victim has no cookie
    });

    it('rejects a state whose nonce does not match the cookie', () => {
        const attacker = buildState('customer');
        const victim = buildState('customer');
        // Victim's browser holds ITS nonce; attacker feeds their own state.
        expect(verifyState(reqFrom(attacker.state, cookieHeader(victim.nonce)))).toBe(false);
    });

    it('rejects a forged cookie signature', () => {
        const { state, nonce } = buildState('customer');
        const forged = `bp_oauth_state=${nonce}.${'0'.repeat(64)}`;
        expect(verifyState(reqFrom(state, forged))).toBe(false);
    });

    it('rejects a missing/blank state', () => {
        const { nonce } = buildState('customer');
        expect(verifyState(reqFrom('', cookieHeader(nonce)))).toBe(false);
        expect(verifyState(reqFrom(undefined, cookieHeader(nonce)))).toBe(false);
    });

    it('still round-trips the role for the redirect origin', () => {
        expect(roleFromState(buildState('provider').state)).toBe('provider');
        expect(roleFromState(buildState('customer').state)).toBe('customer');
        expect(roleFromState(undefined)).toBe('customer'); // safe default
    });

    it('sets an HttpOnly, short-lived, auth-scoped cookie and clears it', () => {
        const { nonce } = buildState('customer');
        const set = cookieHeader(nonce);
        expect(set).toContain('HttpOnly');
        expect(set).toContain('Path=/api/auth');
        expect(set).toContain('SameSite=Lax'); // top-level GET back from Google
        expect(set).toContain('Max-Age=600');
        expect(clearCookieHeader()).toContain('Max-Age=0');
    });
});
