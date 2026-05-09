import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';

const Navbar = () => {
    const { user, logout } = useAuthContext();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <nav className="bg-gray-800 text-white shadow-lg">
            <div className="container mx-auto px-4 py-4 flex justify-between items-center">
                <Link to="/" className="text-2xl font-bold text-yellow-400">
                    BarberShop
                </Link>

                <div className="flex gap-6 items-center">
                    <Link to="/" className="hover:text-yellow-400 transition">
                        Home
                    </Link>
                    <Link to="/services" className="hover:text-yellow-400 transition">
                        Services
                    </Link>
                    {user && user.role === 'customer' && (
                    <Link to="/book-appointment" className="hover:text-yellow-400 transition">
                        Book Appointment
                    </Link>
                    )}

                    {user ? (
                        <>
                            <Link to="/appointments" className="hover:text-yellow-400 transition">
                                My Appointments
                            </Link>
                            <Link to="/waiting-list" className="hover:text-yellow-400 transition">
                                Waiting List
                            </Link>
                            <Link to="/profile" className="hover:text-yellow-400 transition">
                                My Profile
                            </Link>
                            {user.role === 'provider' && (
                                <Link to="/provider/dashboard" className="hover:text-yellow-400 transition">
                                    Provider Dashboard
                                </Link>
                            )}
                            {user.role === 'admin' && (
                                <Link to="/admin/dashboard" className="hover:text-yellow-400 transition">
                                    Admin Dashboard
                                </Link>
                            )}
                            <button
                                onClick={handleLogout}
                                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded transition"
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login" className="hover:text-yellow-400 transition">
                                Login
                            </Link>
                            <Link to="/register" className="bg-yellow-400 text-black px-4 py-2 rounded hover:bg-yellow-500 transition">
                                Sign Up
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;