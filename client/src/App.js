import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Services from './pages/Services';
import BookAppointment from './pages/BookAppointment';
import MyAppointments from './pages/MyAppointments';
import AdminDashboard from './pages/AdminDashboard';
import ProviderDashboard from './pages/ProviderDashboard';
import MyWaitingList from './pages/MyWaitingList';
import Profile from './pages/Profile';
import AnalyticsDashboard from './pages/AnalyticsDashboard';

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
                    <Route path="/services" element={<Services />} />

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

                    {/* Admin only */}
                    <Route path="/admin/dashboard" element={
                        <ProtectedRoute allowedRoles={['admin']}>
                            <AdminDashboard />
                        </ProtectedRoute>
                    } />

                    {/* Provider only */}
                    <Route path="/provider/dashboard" element={
                        <ProtectedRoute allowedRoles={['provider']}>
                            <ProviderDashboard />
                        </ProtectedRoute>
                    } />

                    {/* All authenticated users */}
                    <Route path="/profile" element={
                        <ProtectedRoute allowedRoles={['customer', 'admin', 'provider']}>
                            <Profile />
                        </ProtectedRoute>
                    } />
                    <Route
                        path="/admin/analytics"
                        element={
                            <ProtectedRoute allowedRoles={['admin']}>
                                <AnalyticsDashboard />
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </AuthProvider>
        </Router>
    );
}

export default App;