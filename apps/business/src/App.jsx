import React, { Suspense, lazy, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from '@bookplus/ui';
import { ThemeProvider } from './context/ThemeContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import AppUpdater from './components/AppUpdater';
import SignupSurveyModal, { shouldShowSignupSurvey } from './components/SignupSurveyModal';
import CookieBanner from './components/CookieBanner';
import client, { track } from './services/client';
import Login from './pages/Login';

// Business app route map (DUAL_APP_SPEC.md §2b). Parity migration keeps the
// dashboard's internal tab structure; splitting tabs into §2b's individual
// routes is a follow-up refactor. Admin stays a role-gated area here (locked
// decision §8.3). Customer-side routes live in apps/customer.
const ProviderDashboard = lazy(() => import('./pages/ProviderDashboard'));
const Team = lazy(() => import('./pages/Team'));
const ProviderAccount = lazy(() => import('./pages/ProviderAccount'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AnalyticsDashboard = lazy(() => import('./pages/AnalyticsDashboard'));
const Register = lazy(() => import('./pages/Register'));
const AuthCallback = lazy(() => import('./pages/AuthCallBack'));
const CompleteProfile = lazy(() => import('./pages/CompleteProfile'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const LegalNotice = lazy(() => import('./pages/LegalNotice'));


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
            <main id="main-content" tabIndex={-1} key={location.pathname} className="route-view" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
                <Routes location={location}>
                    {/* Auth */}
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/complete-profile" element={<CompleteProfile />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />
                    <Route path="/forgot-password" element={<ForgotPassword />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/accept-invite" element={<AcceptInvite />} />

                    {/* Legal — provider-facing copies, hosted in the business app */}
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/privacy-policy" element={<PrivacyPolicy />} />
                    <Route path="/legal" element={<LegalNotice />} />

                    {/* The business suite: the owner, and every team member (who sees
                        it through their own profile — ProviderDashboard whitelists the
                        member's tabs). */}
                    <Route path="/dashboard" element={
                        <ProtectedRoute allowedRoles={['provider']} allowCapability={['calendar:view']}>
                            <ProviderDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/team" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <Team />
                        </ProtectedRoute>
                    } />
                    {/* The old "My schedule" page: a team member's services, hours and
                        account now live in the same screens as the owner's. Old links land
                        on their services. */}
                    <Route path="/my-schedule" element={<Navigate to="/dashboard?tab=services" replace />} />
                    <Route path="/account" element={
                        <ProtectedRoute allowedRoles={['provider', 'staff']}>
                            {/* One Account page: a team member sees it over their own profile. */}
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

                    {/* Several notification links (booking confirmed/cancelled/…) use the
                        customer app's '/appointments' path but can reach business-side
                        users. Their bookings live on the dashboard's list tabs — land
                        there explicitly rather than falling through the catch-all. */}
                    <Route path="/appointments" element={<Navigate to="/dashboard?tab=confirmed" replace />} />
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
            </main>
        </Suspense>
    );
}

// The app chrome (Navbar → NotificationBell's 30s poll, the account switcher's
// getSibling) makes authenticated calls on mount. On a page opened from an
// emailed one-time link (accept invite, reset password, verify email) those
// calls ran against whatever dead session the device held, and their 401 →
// failed refresh → forceLogout navigated the invitee away from their form.
// Those pages are standalone screens: no chrome, no background calls.
function AppChrome() {
    const { pathname } = useLocation();
    if (client.isPublicTokenPath(pathname)) return null;
    return <Navbar />;
}

// The business tool is an app, not a website: the footer (legal links and the
// operator's identity) appears only on the public pages — sign-in, sign-up and
// the legal pages themselves.
const FOOTER_PATHS = ['/login', '/register', '/terms', '/privacy-policy', '/legal'];
function FooterGate() {
    const { pathname } = useLocation();
    return FOOTER_PATHS.includes(pathname) ? <Footer /> : null;
}

// Post-signup survey — a one-time "did signup go smoothly?" prompt for the
// provider who owns the account (the person who actually went through /register).
// Gated on the profile's `signupSurvey` field (null/undefined = not answered
// yet) with a localStorage backstop so it never re-shows after submit/dismiss.
// Lives at the app shell level (not tied to any one route) since sign-up →
// email verification → login can land the user on any page.
function SignupSurveyGate() {
    const { user } = useAuthContext();
    const [dismissed, setDismissed] = useState(false);
    if (dismissed || !user || user.role !== 'provider' || !shouldShowSignupSurvey(user)) return null;
    return <SignupSurveyModal onDone={() => setDismissed(true)} />;
}

// WCAG 2.4.1 bypass blocks: the first Tab stop on every page jumps past the
// navigation to the page's <main>. Focus is moved in code (not a #hash link) so
// the router never sees a URL change.
function SkipLink() {
    return (
        <a href="#main-content" className="skip-link" onClick={(e) => {
            const main = document.getElementById('main-content');
            if (!main) return;
            e.preventDefault();
            main.focus();
            main.scrollIntoView({ block: 'start' });
        }}>Skip to content</a>
    );
}

// The business app is a tool, not a website: the cookie banner appears by itself
// only to signed-out visitors on its public pages (login, sign-up, legal pages,
// emailed-link pages). Signed-in owners and staff are never interrupted on their
// dashboard; they choose from Account → Legal → "Cookie settings" (which opens
// the banner anywhere). Until a choice exists, analytics stays off.
const PUBLIC_PATHS = ['/login', '/register', '/terms', '/privacy-policy', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/auth/callback', '/bkplus-command/login'];
function CookieBannerGate() {
    const { user } = useAuthContext();
    const { pathname } = useLocation();
    const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
    return <CookieBanner canAutoShow={!user && isPublic} />;
}

export default function App() {
    return (
        <Router>
            <ThemeProvider>
            <AuthProvider>
                <ToastProvider>
                    {/* App-styled confirm/alert dialogs: any page can `await useConfirm()(…)`
                        instead of window.confirm. They stack at z 2500, under toasts (3000). */}
                    <ConfirmProvider>
                        <AppUpdater />
                        <SkipLink />
                        <AppChrome />
                        <AppRoutes />
                        <FooterGate />
                        <SignupSurveyGate />
                        {/* Analytics runs only after "Accept analytics" here. */}
                        <CookieBannerGate />
                    </ConfirmProvider>
                </ToastProvider>
            </AuthProvider>
            </ThemeProvider>
        </Router>
    );
}
