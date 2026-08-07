import axios, { AxiosError, AxiosInstance } from 'axios';

export type AccountType = 'customer' | 'business';

export interface ApiClientOptions {
    /** Explicit API origin (e.g. https://api.bookplus.pro). When omitted, it is
     *  inferred from window.location the same way the pre-monorepo client did. */
    apiUrl?: string;
    /** Which side of the product this app serves ('customer' | 'business').
     *  Sent with login/refresh so an email holding both a customer and a
     *  business account authenticates as the RIGHT one for this app — the SSO
     *  cookie from the sibling app can no longer bootstrap a wrong-side session. */
    accountType?: AccountType;
}

export const inferApiBase = (explicit?: string): string => {
    if (explicit) return explicit;
    if (typeof window === 'undefined') return 'http://localhost:5050';

    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:5050';
    }
    if (hostname.startsWith('api.')) {
        return `${protocol}//${hostname}`;
    }
    // Strip any subdomain (www., app., business., …) down to the root
    // registrable domain, then prefix with api. — app.bookplus.pro must
    // resolve to api.bookplus.pro, not api.app.bookplus.pro.
    const parts = hostname.split('.');
    const rootDomain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;
    return `${protocol}//api.${rootDomain}`;
};

// Clear the session and bounce to login. Only used when we truly can't recover
// (no refresh token, or the refresh itself failed).
const forceLogout = () => {
    // NEVER tear down the session while the OAuth callback is establishing one.
    // On /auth/callback the page still holds a STALE token from a prior session;
    // background polls (notifications, favorites, …) 401 with it and would
    // trigger this, wiping the FRESH token the callback just stored — stranding
    // the user on /complete-profile with "No token". The callback owns the
    // session here; let it finish.
    if (window.location.pathname === '/auth/callback') return;
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    window.dispatchEvent(new Event('auth-logout'));
    // Redirect to login if not already there
    if (window.location.pathname !== '/login') {
        window.location.href = '/login?error=session_expired';
    }
};

/**
 * Cross-subdomain session bootstrap (SSO): when this app has no stored token
 * but the browser carries the parent-domain refresh cookie from a login made
 * on a sibling app, exchange it for tokens. Returns true when a session is
 * (already or newly) available.
 */
export const bootstrapSession = async (apiBase: string, accountType?: AccountType): Promise<boolean> => {
    if (typeof window === 'undefined') return false;
    if (localStorage.getItem('token')) return true;
    try {
        // accountType scopes the exchange: a cookie belonging to the other
        // side's account is rejected (403) and this app stays logged out.
        const { data } = await axios.post(
            `${apiBase}/api/auth/refresh`,
            accountType ? { accountType } : {},
            { withCredentials: true }
        );
        const token = data?.data?.token;
        if (!token) return false;
        localStorage.setItem('token', token);
        if (data?.data?.refreshToken) localStorage.setItem('refreshToken', data.data.refreshToken);
        return true;
    } catch {
        return false;
    }
};

// Note: accountType deliberately does NOT ride on the interceptor's silent
// refresh below — it guards session ESTABLISHMENT (login, SSO bootstrap), not
// sessions this app already holds, which keep refreshing like before.
export const createHttp = (apiBase: string): AxiosInstance => {
    const API = axios.create({
        baseURL: `${apiBase}/api`,
        // Credentialed requests: without this the browser DISCARDS the SSO
        // refresh cookie set by login/refresh responses (cross-origin XHR only
        // stores cookies when the request itself carried credentials). The API
        // whitelists exact origins with credentials:true, so this is safe.
        withCredentials: true,
        // Without this, a hung refresh (or any hung request) leaves isRefreshing
        // true and every queued request waiting until the OS socket times out —
        // effectively indefinitely. Bound it to something a slow network can
        // still clear, but that fails fast enough to unblock the queue.
        timeout: 20000,
    });

    // Add token to requests
    API.interceptors.request.use((config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    });

    // Single-flight refresh: the first 401 triggers a token refresh; any other
    // requests that 401 while it's in flight wait for the same refresh instead of
    // firing their own (which would race and revoke each other).
    let isRefreshing = false;
    let refreshWaiters: Array<(newToken: string | null) => void> = [];
    const onRefreshed = (newToken: string | null) => {
        refreshWaiters.forEach((cb) => cb(newToken));
        refreshWaiters = [];
    };

    // Handle auth errors globally — try a silent token refresh before giving up.
    API.interceptors.response.use(
        (response) => response,
        async (error: AxiosError) => {
            const originalRequest = error.config as (typeof error.config & { _retry?: boolean });
            const status = error.response?.status;

            // A guest (no stored token) hitting a 401 just means "this endpoint needs
            // auth" — they may simply be browsing public pages while a background call
            // (notifications poll, favorites, etc.) probes an authed route. Never bounce
            // them to the login screen. Only a real, expired session (we HAD a token)
            // should attempt a silent refresh and, failing that, force logout.
            const hadToken = !!localStorage.getItem('token');
            const shouldTryRefresh =
                status === 401 &&
                hadToken &&
                originalRequest &&
                !originalRequest._retry &&
                !originalRequest.url?.includes('/auth/refresh');

            if (!shouldTryRefresh) {
                return Promise.reject(error);
            }

            // No locally stored refresh token can still mean a valid session:
            // the SSO cookie (set by a login on a sibling subdomain) is sent
            // withCredentials and the server accepts it in place of the body
            // token. Only give up when the refresh itself is rejected.
            const refreshToken = localStorage.getItem('refreshToken');

            originalRequest._retry = true;

            // A refresh is already underway — queue this request until it resolves.
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    refreshWaiters.push((newToken) => {
                        if (newToken) {
                            originalRequest.headers.Authorization = `Bearer ${newToken}`;
                            resolve(API(originalRequest));
                        } else {
                            reject(error);
                        }
                    });
                });
            }

            isRefreshing = true;
            try {
                // Bare axios call so we don't recurse back through this interceptor.
                // withCredentials carries the SSO refresh cookie (and stores its rotation).
                const { data } = await axios.post(
                    `${apiBase}/api/auth/refresh`,
                    refreshToken ? { refreshToken } : {},
                    { withCredentials: true }
                );
                const newToken = data?.data?.token;
                const newRefreshToken = data?.data?.refreshToken;
                if (!newToken) {
                    // A 2xx with no token is just as unrecoverable as a 401/403 refresh:
                    // there is no valid session to keep waiters queued behind. Mark it
                    // so the catch below forces the same clean logout, instead of
                    // leaving the stale token in place and retrying forever.
                    const noTokenError = new Error('No token in refresh response') as Error & {
                        isAuthFailure?: boolean;
                    };
                    noTokenError.isAuthFailure = true;
                    throw noTokenError;
                }

                localStorage.setItem('token', newToken);
                if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);

                onRefreshed(newToken);
                originalRequest.headers.Authorization = `Bearer ${newToken}`;
                return API(originalRequest);
            } catch (refreshError) {
                // Release any queued requests. Only force logout when the refresh was
                // genuinely REJECTED (401/403 = invalid / expired / revoked). A network
                // or 5xx failure is transient — keep the session so a blip doesn't sign
                // the user out; a later request will retry the refresh.
                onRefreshed(null);
                const st = (refreshError as AxiosError).response?.status;
                const isAuthFailure =
                    st === 401 || st === 403 || (refreshError as { isAuthFailure?: boolean })?.isAuthFailure === true;
                if (isAuthFailure) forceLogout();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
    );

    return API;
};
