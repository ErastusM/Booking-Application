import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

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

// Handle auth errors globally
API.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            window.dispatchEvent(new Event('auth-logout'));
            // Redirect to login if not already there
            if (window.location.pathname !== '/login' && window.location.pathname !== '/auth/callback') {
                window.location.href = '/login?error=session_expired';
            }
        }
        return Promise.reject(error);
    }
);

export { API_BASE };
export default API;
