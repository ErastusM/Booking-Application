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
import './styles/index.css';

function App() {
    return (
        <Router>
            <AuthProvider>
                <Navbar />
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/services" element={<Services />} />
                    <Route
                        path="/book-appointment"
                        element={
                            <ProtectedRoute>
                                <BookAppointment />
                            </ProtectedRoute>
                        }
                    />
                    <Route
                        path="/appointments"
                        element={
                            <ProtectedRoute>
                                <MyAppointments />
                            </ProtectedRoute>
                        }
                    />
                </Routes>
            </AuthProvider>
        </Router>
    );
}

export default App;
