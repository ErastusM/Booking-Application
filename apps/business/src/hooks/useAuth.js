import React, { useState, useCallback, useEffect } from 'react';
import API from '../services/api';
import client from '../services/client';
import { can, canAny } from '../utils/permissions';

// Pages opened from an emailed one-time link (/accept-invite, /reset-password,
// /verify-email). Evaluated when the app boots on one of them.
const onPublicTokenPage = () => {
    try { return client.isPublicTokenPath(window.location.pathname); } catch { return false; }
};

const readCachedUser = () => {
    try {
        const cached = localStorage.getItem('user');
        return cached ? JSON.parse(cached) : null;
    } catch { return null; }
};

export const useAuth = () => {
    // Booted on an emailed-link page: that page must not adopt, validate or
    // refresh whatever session this device happens to hold. Doing so used to
    // 401 → failed refresh → forceLogout → redirect to /login a fraction of a
    // second after an invited member's "create password" form appeared.
    const [tokenPage] = useState(onPublicTokenPage);
    // Who is signed in on this device, for a notice only ("You're signed in as
    // X on this device…") — never used as the session on a token page.
    const [deviceSession] = useState(() => {
        const u = localStorage.getItem('token') ? readCachedUser() : null;
        return u ? { name: u.name || '', email: u.email || '' } : null;
    });
    // Hydrate the user from cache so a returning client sees the app logged-in
    // instantly — no spinner, no flash of the login page — while we re-validate the
    // session in the background. Only hydrate when a token is also present.
    const [user, setUser] = useState(() => {
        try {
            if (onPublicTokenPage()) return null;
            if (!localStorage.getItem('token')) return null;
            const cached = localStorage.getItem('user');
            return cached ? JSON.parse(cached) : null;
        } catch { return null; }
    });
    const [token, setToken] = useState(() => (onPublicTokenPage() ? null : localStorage.getItem('token')));
    // Only block the UI when we have a token but no cached user to show yet.
    // Guests also start 'loading' until the SSO bootstrap settles, so a
    // protected route doesn't bounce to /login while the sibling-app cookie
    // is being exchanged (resolves in one fast round-trip).
    const [loading, setLoading] = useState(() => !onPublicTokenPage() && !(localStorage.getItem('token') && localStorage.getItem('user')));
    const [error, setError] = useState(null);
    // True once this load's session check has settled (profile answered, or
    // there was nothing to check). /login uses it to send an already signed-in
    // user home without acting on a cached user whose session is dead.
    const [sessionChecked, setSessionChecked] = useState(false);

    // Persist the user so reopening the app restores the session instantly.
    // (On a token page the initial null user must not erase the cache — the
    // page hasn't touched the device's session; only a login or logout does.)
    const firstPersist = React.useRef(true);
    useEffect(() => {
        const skip = firstPersist.current && tokenPage;
        firstPersist.current = false;
        if (skip) return;
        try {
            if (user) localStorage.setItem('user', JSON.stringify(user));
            else localStorage.removeItem('user');
        } catch { /* storage disabled/full — non-fatal */ }
    }, [user, tokenPage]);

    // On app load, validate/refresh the cached session in the BACKGROUND. We never
    // block on this and never log out on a transient error (offline, slow API, 5xx) —
    // only a genuine auth failure the API interceptor can't refresh away clears the
    // session (via forceLogout → 'auth-logout'). This keeps clients signed in across
    // reopens instead of bouncing them to login on any hiccup.
    useEffect(() => {
        let cancelled = false;
        (async () => {
        // The OAuth callback page OWNS session establishment (it exchanges the
        // one-time code for a fresh token). Running the normal bootstrap here
        // races it: a STALE token left in localStorage makes /auth/profile 401
        // → the interceptor's refresh 401s → forceLogout wipes the session —
        // including the fresh token the callback just stored. Skip bootstrap here.
        if (window.location.pathname === '/auth/callback') { setLoading(false); setSessionChecked(true); return; }
        // Emailed-link pages (see tokenPage): no cached-user hydration, no SSO
        // bootstrap, no /auth/profile. The page itself establishes a session
        // (accept invite → login()) or sends them to sign in.
        if (tokenPage) { setLoading(false); setSessionChecked(true); return; }
        let savedToken = localStorage.getItem('token');
        // SSO (spec §8): no local session — a login on the sibling app may have
        // left the parent-domain refresh cookie; exchange it for tokens.
        if (!savedToken && client.bootstrapSession) {
            const ok = await client.bootstrapSession();
            if (ok) savedToken = localStorage.getItem('token');
        }
        if (!savedToken || cancelled) { if (!cancelled) { setLoading(false); setSessionChecked(true); } return; }
        API.get('/auth/profile')
            .then((response) => {
                if (cancelled) return;
                setUser(response.data.data);
                setToken(savedToken);
            })
            .catch(() => { /* interceptor handles real auth failures; otherwise keep the cached session */ })
            .finally(() => { if (!cancelled) { setLoading(false); setSessionChecked(true); } });
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const handleAuthLogout = () => {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('activeRole'); // legacy key from the old in-app role switch
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
        };

        window.addEventListener('auth-logout', handleAuthLogout);
        return () => window.removeEventListener('auth-logout', handleAuthLogout);
    }, []);

    const login = useCallback((userData) => {
        localStorage.setItem('token', userData.token);
        if (userData.refreshToken) {
            localStorage.setItem('refreshToken', userData.refreshToken);
        }
        setToken(userData.token);
        setUser(userData.user);
        setError(null);
        setSessionChecked(true);
    }, []);

    const logout = useCallback(async () => {
        try {
            await API.post('/auth/logout');
        } catch {
            // Continue with local logout even if API call fails
        }
        window.dispatchEvent(new Event('auth-logout'));
    }, []);

    // Capability helpers for UI gating (owners/admins hold everything; a team
    // member holds the member set). Server-side checks remain the real guard.
    const hasCap = useCallback((cap) => can(user, cap), [user]);
    const hasAnyCap = useCallback((caps) => canAny(user, caps), [user]);

    // Re-read the signed-in user from the API (e.g. straight after accepting an
    // invite, so the business they belong to is the server's, not a guess).
    const refreshProfile = useCallback(async () => {
        try {
            const response = await API.get('/auth/profile');
            if (response?.data?.data) setUser(response.data.data);
            return response?.data?.data || null;
        } catch { return null; }
    }, []);

    return { user, token, loading, sessionChecked, error, login, logout, setUser, hasCap, hasAnyCap, deviceSession, refreshProfile };
};
