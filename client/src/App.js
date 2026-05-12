import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import BookAppointment from './pages/BookAppointment';
import MyAppointments from './pages/MyAppointments';
import AdminDashboard from './pages/AdminDashboard';
import ProviderDashboard from './pages/ProviderDashboard';
import MyWaitingList from './pages/MyWaitingList';
import Profile from './pages/Profile';
import AnalyticsDashboard from './pages/AnalyticsDashboard';
import ProvidersPage from './pages/ProviderPage';
import ProviderProfilePage from './pages/ProviderProfilePage';
import AuthCallback from './pages/AuthCallBack';
import CompleteProfile from './pages/CompleteProfile';
import VerifyEmail from './pages/VerifyEmail';

function App() {
    return (
        <Router>
            <AuthProvider>
                <Navbar />
                <Routes>
                    {/* Public routes */}
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/services" element={<ProvidersPage />} />
                    <Route path="/providers/:id" element={<ProviderProfilePage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />
                    <Route path="/verify-email" element={<VerifyEmail />} />

                    {/* Customer only */}
                    <Route path="/book-appointment" element={
                        <ProtectedRoute allowedRoles={['customer']}>
                            <BookAppointment />
                        </ProtectedRoute>
                    } />
                    <Route path="/appointments" element={
                        <ProtectedRoute allowedRoles={['customer']}>
                            <MyAppointments />
                        </ProtectedRoute>
                    } />
                    <Route path="/waiting-list" element={
                        <ProtectedRoute allowedRoles={['customer']}>
                            <MyWaitingList />
                        </ProtectedRoute>
                    } />

                    {/* Provider only */}
                    <Route path="/dashboard" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderDashboard />
                        </ProtectedRoute>
                    } />

                    {/* Admin only */}
                    <Route path="/admin/dashboard" element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <AdminDashboard />
                        </ProtectedRoute>
                    } />
                    <Route path="/admin/analytics" element={
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
            </AuthProvider>
        </Router>
    );
}

export default App;