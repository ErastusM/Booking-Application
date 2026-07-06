import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';

// Customer app route map (DUAL_APP_SPEC.md §2a). Provider/admin routes live in
// apps/business; the Navbar's dashboard links point there once 1.4 wires the
// cross-app hand-off. Heavy screens are lazy-loaded.
const BookAppointment = lazy(() => import('./pages/BookAppointment'));
const MyAppointments = lazy(() => import('./pages/MyAppointments'));
const MyWaitingList = lazy(() => import('./pages/MyWaitingList'));
const Profile = lazy(() => import('./pages/Profile'));
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
const About = lazy(() => import('./pages/About'));
const ManageBooking = lazy(() => import('./pages/ManageBooking'));
const Wallet = lazy(() => import('./pages/Wallet'));

const RouteFallback = () => (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '36px', height: '36px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    </div>
);

function AppRoutes() {
    const location = useLocation();

    // Jump to the top on every route change — instant, so navigation never
    // rides the page's smooth scroll-behavior.
    React.useEffect(() => {
        try {
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        } catch {
            window.scrollTo(0, 0);
        }
    }, [location.pathname]);

    return (
        <Suspense fallback={<RouteFallback />}>
            <div key={location.pathname} className="route-view" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                <Routes location={location}>
                    {/* Public routes */}
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/services" element={<ProvidersPage />} />
                    <Route path="/about" element={<About />} />
                    <Route path="/providers/:id" element={<ProviderProfilePage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/manage/:token" element={<ManageBooking />} />

                    {/* Customer-context — providers can also act as customers */}
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

                    {/* All authenticated users */}
                    <Route path="/profile" element={
                        <ProtectedRoute allowedRoles={['customer', 'admin', 'provider']}>
                            <Profile />
                        </ProtectedRoute>
                    } />
                    <Route path="/complete-profile" element={<CompleteProfile />} />

                    <Route path="*" element={<Navigate to="/" replace />} />
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
