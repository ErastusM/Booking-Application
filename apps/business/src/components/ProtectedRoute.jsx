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
        // Redirect to their rightful home inside the business app…
        if (user.role === 'admin') return <Navigate to="/bkplus-command" replace />;
        if (user.role === 'staff') return <Navigate to="/my-schedule" replace />;
        if (user.role === 'provider') return <Navigate to="/dashboard" replace />;
        // …customers belong in the customer app (cross-app hand-off).
        window.location.replace(import.meta.env.VITE_CUSTOMER_URL || 'http://localhost:3002');
        return null;
    }

    return children;
};

export default ProtectedRoute;