import { useState, useCallback, useEffect } from 'react';
import API from '../services/api';
import client from '../services/client';

const BUSINESS_URL = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';

export const useAuth = () => {
    // Hydrate the user from cache so a returning client sees the app logged-in
    // instantly — no spinner, no flash of the login page — while we re-validate the
    // session in the background. Only hydrate when a token is also present.
    const [user, setUser] = useState(() => {
        try {
            if (!localStorage.getItem('token')) return null;
            const cached = localStorage.getItem('user');
            return cached ? JSON.parse(cached) : null;
        } catch { return null; }
    });
    const [token, setToken] = useState(localStorage.getItem('token'));
    // Only block the UI when we have a token but no cached user to show yet.
    // Guests also start 'loading' until the SSO bootstrap settles, so a
    // protected route doesn't bounce to /login while the sibling-app cookie
    // is being exchanged (resolves in one fast round-trip).
    const [loading, setLoading] = useState(() => !(localStorage.getItem('token') && localStorage.getItem('user')));
    const [error, setError] = useState(null);

    // Persist the user so reopening the app restores the session instantly.
    useEffect(() => {
        try {
            if (user) localStorage.setItem('user', JSON.stringify(user));
            else localStorage.removeItem('user');
        } catch { /* storage disabled/full — non-fatal */ }
    }, [user]);

    // This app is the CUSTOMER experience — a business-side session must never
    // render here as a signed-in "customer". The main way one used to appear
    // (become-provider flipping the account under a live customer session, then
    // the silent refresh keeping it alive forever) is fixed at the source, but
    // sessions stranded before that fix — or any future wrong-side leak — get
    // ejected here: clear the local session and hand the person to their app.
    useEffect(() => {
        if (!user?.role || user.role === 'customer') return;
        const home = user.role === 'admin' ? '/bkplus-command'
            : user.role === 'staff' ? '/my-schedule' : '/dashboard';
        try {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('user');
        } catch { /* non-fatal */ }
        window.location.replace(`${BUSINESS_URL}${home}`);
    }, [user]);

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
        // including the fresh token the callback just stored — leaving the user
        // stranded on /complete-profile with "No token". Skip bootstrap here.
        if (window.location.pathname === '/auth/callback') { setLoading(false); return; }
        let savedToken = localStorage.getItem('token');
        // SSO (spec §8): no local session — a login on the sibling app may have
        // left the parent-domain refresh cookie; exchange it for tokens.
        if (!savedToken && client.bootstrapSession) {
            const ok = await client.bootstrapSession();
            if (ok) savedToken = localStorage.getItem('token');
        }
        if (!savedToken || cancelled) { if (!cancelled) setLoading(false); return; }
        API.get('/auth/profile')
            .then((response) => {
                if (cancelled) return;
                setUser(response.data.data);
                setToken(savedToken);
            })
            .catch(() => { /* interceptor handles real auth failures; otherwise keep the cached session */ })
            .finally(() => { if (!cancelled) setLoading(false); });
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
    }, []);

    const logout = useCallback(async () => {
        try {
            await API.post('/auth/logout');
        } catch {
            // Continue with local logout even if API call fails
        }
        window.dispatchEvent(new Event('auth-logout'));
    }, []);

    return { user, token, loading, error, login, logout, setUser };
};
