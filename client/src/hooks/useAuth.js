import { useState, useCallback, useEffect } from 'react';
import API from '../services/api';

export const useAuth = () => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // On app load, if a token exists, fetch the user profile to restore session
    useEffect(() => {
        const restoreSession = async () => {
            const savedToken = localStorage.getItem('token');
            if (!savedToken) {
                setLoading(false);
                return;
            }
            try {
                const response = await API.get('/auth/profile');
                setUser(response.data.data);
                setToken(savedToken);
            } catch (err) {
                // Token is invalid or expired — clear it
                window.dispatchEvent(new Event('auth-logout'));
            } finally {
                setLoading(false);
            }
        };

        restoreSession();
    }, []);

    useEffect(() => {
        const handleAuthLogout = () => {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
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