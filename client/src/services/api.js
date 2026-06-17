import axios from 'axios';

const inferApiBase = () => {
    if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
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

const API_BASE = inferApiBase();

const API = axios.create({
    baseURL: `${API_BASE}/api`
});

// Add token to requests
API.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

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

// Single-flight refresh: the first 401 triggers a token refresh; any other
// requests that 401 while it's in flight wait for the same refresh instead of
// firing their own (which would race and revoke each other).
let isRefreshing = false;
let refreshWaiters = [];
const onRefreshed = (newToken) => {
    refreshWaiters.forEach((cb) => cb(newToken));
    refreshWaiters = [];
};

// Handle auth errors globally — try a silent token refresh before giving up.
API.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        const status = error.response?.status;

        // Only attempt a refresh for a genuine 401 on a normal request we haven't
        // already retried — and never for the refresh call itself.
        const shouldTryRefresh =
            status === 401 &&
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
            const { data } = await axios.post(`${API_BASE}/api/auth/refresh`, { refreshToken });
            const newToken = data?.data?.token;
            const newRefreshToken = data?.data?.refreshToken;
            if (!newToken) throw new Error('No token in refresh response');

            localStorage.setItem('token', newToken);
            if (newRefreshToken) localStorage.setItem('refreshToken', newRefreshToken);

            onRefreshed(newToken);
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            return API(originalRequest);
        } catch (refreshError) {
            // Refresh failed — release any queued requests and log out for real.
            onRefreshed(null);
            forceLogout();
            return Promise.reject(refreshError);
        } finally {
            isRefreshing = false;
        }
    }
);

export { API_BASE };
export default API;
