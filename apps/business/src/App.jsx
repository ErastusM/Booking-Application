import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import AppUpdater from './components/AppUpdater';
import { track } from './services/client';
import Login from './pages/Login';

// Business app route map (DUAL_APP_SPEC.md §2b). Parity migration keeps the
// dashboard's internal tab structure; splitting tabs into §2b's individual
// routes is a follow-up refactor. Admin stays a role-gated area here (locked
// decision §8.3). Customer-side routes live in apps/customer.
const ProviderDashboard = lazy(() => import('./pages/ProviderDashboard'));
const Team = lazy(() => import('./pages/Team'));
const MySchedule = lazy(() => import('./pages/MySchedule'));
const ProviderAccount = lazy(() => import('./pages/ProviderAccount'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'));
const Register = lazy(() => import('./pages/Register'));
const AuthCallback = lazy(() => import('./pages/AuthCallBack'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

const RouteFallback = () => (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
);

function AppRoutes() {
    const location = useLocation();

    React.useEffect(() => {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
            window.scrollTo(0, 0);
        }
        // Funnel backbone: one page_view per navigation.
        track('page_view');
    }, [location.pathname]);

    return (
        <Suspense fallback={<RouteFallback />}>
            <div key={location.pathname} className="route-view" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                <Routes location={location}>
                    {/* Auth */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />

                    {/* Provider suite — staff joins in Epic 2.4 with a scoped view */}
                    <Route path="/dashboard" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/team" element={
                        <ProtectedRoute allowedRoles={['provider', 'admin']}>
                            <Team />
                        </ProtectedRoute>
                    } />
                    <Route path="/my-schedule" element={
                        <ProtectedRoute allowedRoles={['staff']}>
                            <MySchedule />
                        </ProtectedRoute>
                    } />
                    <Route path="/account" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderAccount />
                        </ProtectedRoute>
                    } />

                    {/* Admin — role-gated area of the business app, with its own
                        branded sign-in so it's unmistakably the admin console. */}
                    <Route path="/bkplus-command/login" element={<AdminLogin />} />
                    <Route path="/bkplus-command" element={
                        <ProtectedRoute allowedRoles={['admin']} loginPath="/bkplus-command/login">
                            <AdminDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/bkplus-command/insights" element={
                        <ProtectedRoute allowedRoles={['admin']} loginPath="/bkplus-command/login">
                            <AnalyticsDashboard />
                        </ProtectedRoute>
                    } />

                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
            </div>
        </Suspense>
    );
}

export default function App() {
    return (
        <Router>
            <ThemeProvider>
            <AuthProvider>
                <ToastProvider>
                    {/* No footer in the business tool — it's an app, not a website. */}
                    <AppUpdater />
                    <Navbar />
                    <AppRoutes />
                </ToastProvider>
            </AuthProvider>
            </ThemeProvider>
        </Router>
    );
}
