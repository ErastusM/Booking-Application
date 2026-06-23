import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';

// Heavy screens are lazy-loaded so the initial bundle stays lean
const BookAppointment = lazy(() => import('./pages/BookAppointment'));
const MyAppointments = lazy(() => import('./pages/MyAppointments'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const ProviderDashboard = lazy(() => import('./pages/ProviderDashboard'));
const ProviderAccount = lazy(() => import('./pages/ProviderAccount'));
const MyWaitingList = lazy(() => import('./pages/MyWaitingList'));
const Profile = lazy(() => import('./pages/Profile'));
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'));
const ProvidersPage = lazy(() => import('./pages/ProviderPage'));
const ProviderProfilePage = lazy(() => import('./pages/ProviderProfilePage'));
const AuthCallback = lazy(() => import('./pages/AuthCallBack'));
const CompleteProfile = lazy(() => import('./pages/CompleteProfile'));
const BecomeProvider = lazy(() => import('./pages/BecomeProvider'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const ManageBooking = lazy(() => import('./pages/ManageBooking'));
const Wallet = lazy(() => import('./pages/Wallet'));

const RouteFallback = () => (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
);

function AppRoutes() {
    const location = useLocation();

    // Jump to the top on every route change. We force an instant jump so navigation
    // feels immediate — without it the page's smooth scroll-behavior glided the whole
    // way up on each route change, which read as sluggish/janky scrolling.
    React.useEffect(() => {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
            window.scrollTo(0, 0);
        }
    }, [location.pathname]);

    return (
        <Suspense fallback={<RouteFallback />}>
            <div key={location.pathname} className="route-view">
                <Routes location={location}>
                    {/* Public routes */}
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/services" element={<ProvidersPage />} />
                    <Route path="/providers/:id" element={<ProviderProfilePage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/manage/:token" element={<ManageBooking />} />

                    {/* Customer-context — providers can also act as customers (one account, both modes) */}
                    <Route path="/book-appointment" element={
                        <ProtectedRoute allowedRoles={['customer', 'provider']}>
                            <BookAppointment />
                        </ProtectedRoute>
                    } />
                    <Route path="/appointments" element={
                        <ProtectedRoute allowedRoles={['customer', 'provider']}>
                            <MyAppointments />
                        </ProtectedRoute>
                    } />
                    <Route path="/waiting-list" element={
                        <ProtectedRoute allowedRoles={['customer', 'provider']}>
                            <MyWaitingList />
                        </ProtectedRoute>
                    } />
                    <Route path="/wallet" element={
                        <ProtectedRoute allowedRoles={['customer', 'provider']}>
                            <Wallet />
                        </ProtectedRoute>
                    } />
                    <Route path="/become-provider" element={
                        <ProtectedRoute allowedRoles={['customer']}>
                            <BecomeProvider />
                        </ProtectedRoute>
                    } />

                    {/* Provider only */}
                    <Route path="/dashboard" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/account" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderAccount />
                        </ProtectedRoute>
                    } />

                    {/* Admin only */}
                    <Route path="/bkplus-command" element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <AdminDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/bkplus-command/insights" element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <AnalyticsDashboard />
                        </ProtectedRoute>
                    } />

                    {/* All authenticated users */}
                    <Route path="/profile" element={
                        <ProtectedRoute allowedRoles={['customer', 'admin', 'provider']}>
                            <Profile />
                        </ProtectedRoute>
                    } />
                    <Route path="/complete-profile" element={<CompleteProfile />} />
                </Routes>
            </div>
        </Suspense>
    );
}

function App() {
    return (
        <Router>
            <ThemeProvider>
            <AuthProvider>
                <Navbar />
                <AppRoutes />
                <Footer />
            </AuthProvider>
            </ThemeProvider>
        </Router>
    );
}

export default App;
