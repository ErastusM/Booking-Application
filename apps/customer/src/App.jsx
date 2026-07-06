import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';

// Epic 1.2 vertical slice: discovery -> profile -> booking -> my appointments.
// Remaining customer routes (§2a) migrate page-by-page on this branch.
const Login = lazy(() => import('./pages/Login'));
const ProvidersPage = lazy(() => import('./pages/ProviderPage'));
const ProviderProfilePage = lazy(() => import('./pages/ProviderProfilePage'));
const BookAppointment = lazy(() => import('./pages/BookAppointment'));
const MyAppointments = lazy(() => import('./pages/MyAppointments'));

const Loading = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)', color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
        Loading…
    </div>
);

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <Suspense fallback={<Loading />}>
                        <Routes>
                            <Route path="/login" element={<Login />} />
                            <Route path="/services" element={<ProvidersPage />} />
                            <Route path="/providers/:id" element={<ProviderProfilePage />} />
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
                            <Route path="*" element={<Navigate to="/services" replace />} />
                        </Routes>
                    </Suspense>
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    );
}
