import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const ProtectedRoute = ({ children, allowedRoles }) => {
    const { user, loading } = useAuthContext();

    if (loading) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                    width: '40px', height: '40px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--gold)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    if (!user) return <Navigate to="/login" replace />;

    if (allowedRoles && !allowedRoles.includes(user.role)) {
        // Business-side roles belong on the business app — hand them to their
        // rightful home there (the mirror of what the business app already does
        // for customers), instead of a silent, unexplained bounce to the feed.
        if (user.role === 'provider' || user.role === 'staff' || user.role === 'admin') {
            const home = user.role === 'admin' ? '/bkplus-command'
                : user.role === 'staff' ? '/my-schedule' : '/dashboard';
            window.location.replace(`${import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003'}${home}`);
            return null;
        }
        return <Navigate to="/" replace />;
    }

    return children;
};

export default ProtectedRoute;