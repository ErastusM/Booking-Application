import axios, { AxiosError, AxiosInstance } from 'axios';

export interface ApiClientOptions {
    /** Explicit API origin (e.g. https://api.bookplus.pro). When omitted, it is
     *  inferred from window.location the same way the pre-monorepo client did. */
    apiUrl?: string;
}

export const inferApiBase = (explicit?: string): string => {
    if (explicit) return explicit;
    if (typeof window === 'undefined') return 'http://localhost:5000';

    const { protocol, hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://localhost:5000';
    }
    if (hostname.startsWith('api.')) {
        return `${protocol}//${hostname}`;
    }
    if (hostname.startsWith('www.')) {
        return `${protocol}//api.${hostname.slice(4)}`;
    }
    return `${protocol}//api.${hostname}`;
};

// Clear the session and bounce to login. Only used when we truly can't recover
// (no refresh token, or the refresh itself failed).
const forceLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    window.dispatchEvent(new Event('auth-logout'));
    // Redirect to login if not already there
    if (window.location.pathname !== '/login' && window.location.pathname !== '/auth/callback') {
        window.location.href = '/login?error=session_expired';
    }
};

export const createHttp = (apiBase: string): AxiosInstance => {
    const API = axios.create({
        baseURL: `${apiBase}/api`
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

            const refreshToken = localStorage.getItem('refreshToken');
            if (!refreshToken) {
                forceLogout();
                return Promise.reject(error);
            }

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
                const { data } = await axios.post(`${apiBase}/api/auth/refresh`, { refreshToken });
                const newToken = data?.data?.token;
                const newRefreshToken = data?.data?.refreshToken;
                if (!newToken) throw new Error('No token in refresh response');

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
                if (st === 401 || st === 403) forceLogout();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
    );

    return API;
};
