import React, { useState, useCallback } from 'react';

export const useAuth = () => {
    const [user, setUser] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('token'));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const login = useCallback((userData) => {
        setLoading(true);
        setError(null);
        localStorage.setItem('token', userData.token);
        setToken(userData.token);
        setUser(userData.user);
        setLoading(false);
    }, []);

    const logout = useCallback(() => {
        setUser(null);
        setToken(null);
        localStorage.removeItem('token');
    }, []);

    return { user, token, loading, error, login, logout, setUser };
};
