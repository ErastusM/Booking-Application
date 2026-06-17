import { useState, useCallback, useEffect } from 'react';
import API from '../services/api';

export const useAuth = () => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeRole, setActiveRole] = useState(null);

    // Sync activeRole whenever the user record changes.
    // Providers can toggle between 'provider' and 'customer' views; the choice
    // is persisted so it survives page refreshes. All other roles are fixed.
    useEffect(() => {
        if (!user) { setActiveRole(null); return; }
        if (user.role === 'provider') {
            const saved = localStorage.getItem('activeRole');
            setActiveRole(saved === 'customer' || saved === 'provider' ? saved : 'provider');
        } else {
            setActiveRole(user.role);
        }
    }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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
            localStorage.removeItem('activeRole');
            setToken(null);
            setUser(null);
            setActiveRole(null);
        };

        window.addEventListener('auth-logout', handleAuthLogout);
        return () => window.removeEventListener('auth-logout', handleAuthLogout);
    }, []);

    const login = useCallback((userData) => {
        localStorage.setItem('token', userData.token);
        if (userData.refreshToken) {
            localStorage.setItem('refreshToken', userData.refreshToken);
        }
        // Always reset to the account's real role on fresh login.
        localStorage.setItem('activeRole', userData.user.role);
        setToken(userData.token);
        setUser(userData.user);
        setActiveRole(userData.user.role);
        setError(null);
    }, []);

    // Toggle (or explicitly set) which view a provider is currently using.
    // Only provider accounts can switch; customers and admins are fixed.
    const switchRole = useCallback((role) => {
        if (!user || user.role !== 'provider') return;
        const next = role || (activeRole === 'provider' ? 'customer' : 'provider');
        setActiveRole(next);
        localStorage.setItem('activeRole', next);
    }, [user, activeRole]);

    const logout = useCallback(async () => {
        try {
            await API.post('/auth/logout');
        } catch {
            // Continue with local logout even if API call fails
        }
        window.dispatchEvent(new Event('auth-logout'));
    }, []);

    return { user, token, loading, error, login, logout, setUser, activeRole, switchRole };
};
