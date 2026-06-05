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
                localStorage.removeItem('token');
                localStorage.removeItem('refreshToken');
                setToken(null);
                setUser(null);
            } finally {
                setLoading(false);
            }
        };

        restoreSession();
    }, []);

    const login = useCallback((userData) => {
        localStorage.setItem('token', userData.token);
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
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        setToken(null);
        setUser(null);
    }, []);

    return { user, token, loading, error, login, logout, setUser };
};