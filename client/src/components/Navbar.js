import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import NotificationBell from './NotificationBell';

const Navbar = () => {
    const { user, logout } = useAuthContext();
    const navigate = useNavigate();
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

    const isHome = location.pathname === '/';
    const isTransparent = isHome && !scrolled;

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => { setMenuOpen(false); }, [location]);

    useEffect(() => {
        document.body.classList.toggle('dark-mode', darkMode);
        localStorage.setItem('darkMode', darkMode);
    }, [darkMode]);

    const handleLogout = () => { logout(); navigate('/'); };
    const isActive = (path) => location.pathname === path;

    const navLink = (to, label) => (
        <Link to={to} style={{
            color: isActive(to) ? 'var(--gold)' : isTransparent ? 'white' : 'var(--text-primary)',
            borderBottom: isActive(to) ? '2px solid var(--gold)' : '2px solid transparent',
            paddingBottom: '2px',
            fontWeight: isActive(to) ? '600' : '400',
            transition: 'all 0.2s ease',
            fontSize: '0.9rem',
            textDecoration: 'none',
        }}
            onMouseEnter={e => { if (!isActive(to)) e.target.style.color = 'var(--gold)'; }}
            onMouseLeave={e => { if (!isActive(to)) e.target.style.color = isTransparent ? 'white' : 'var(--text-primary)'; }}
        >
            {label}
        </Link>
    );

    const navStyles = {
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000,
        transition: 'all 0.3s ease',
        background: isTransparent ? 'transparent' : darkMode ? 'rgba(15,15,26,0.97)' : 'rgba(255,255,255,0.97)',
        backdropFilter: isTransparent ? 'none' : 'blur(12px)',
        boxShadow: isTransparent ? 'none' : 'var(--shadow-sm)',
        borderBottom: isTransparent ? 'none' : '1px solid var(--border)',
        color: isTransparent ? 'white' : 'var(--text-primary)',
    };

    const mobileLink = (to, label) => (
        <Link to={to} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: '500' }}>{label}</Link>
    );

    return (
        <nav style={navStyles}>
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '72px' }}>

                {/* Logo */}
                <Link to="/" style={{ textDecoration: 'none' }}>
                    <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.6rem', fontWeight: '700', color: 'var(--gold)', letterSpacing: '-0.02em' }}>
                        Book<span style={{ color: isTransparent ? 'white' : 'var(--charcoal)' }}>plus</span>
                    </span>
                </Link>

                {/* Desktop links */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }} className="hidden-mobile">
                    {navLink('/', 'Home')}
                    {navLink('/services', 'Services')}
                    {user?.role === 'customer' && navLink('/book-appointment', 'Book')}
                    {user?.role === 'customer' && navLink('/appointments', 'Appointments')}
                    {user?.role === 'customer' && navLink('/waiting-list', 'Waiting List')}
                    {user?.role === 'provider' && navLink('/dashboard', 'Dashboard')}
                    {user?.role === 'admin' && navLink('/admin/dashboard', 'Dashboard')}
                    {user?.role === 'admin' && navLink('/admin/analytics', 'Analytics')}
                </div>

                {/* Right side */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }} className="hidden-mobile">
                    {user ? (
                        <>
                            <NotificationBell isTransparent={isTransparent} />
                            <Link to="/profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: isTransparent ? 'white' : 'var(--text-primary)', fontSize: '0.9rem', fontWeight: '500' }}>
                                <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--charcoal)', fontWeight: '700', fontSize: '0.8rem' }}>
                                    {user.name?.charAt(0).toUpperCase()}
                                </div>
                                {user.name?.split(' ')[0]}
                            </Link>
                            <button onClick={handleLogout} style={{
                                background: 'transparent', border: '1.5px solid',
                                borderColor: isTransparent ? 'rgba(255,255,255,0.4)' : 'var(--border)',
                                color: isTransparent ? 'white' : 'var(--text-secondary)',
                                padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer', fontSize: '0.85rem',
                                fontFamily: 'Inter, sans-serif', transition: 'all 0.2s ease',
                            }}
                                onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
                                onMouseLeave={e => { e.target.style.borderColor = isTransparent ? 'rgba(255,255,255,0.4)' : 'var(--border)'; e.target.style.color = isTransparent ? 'white' : 'var(--text-secondary)'; }}
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login" style={{ color: isTransparent ? 'white' : 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: '500', transition: 'color 0.2s' }}>Login</Link>
                            <Link to="/register" className="btn-primary" style={{ padding: '0.5rem 1.25rem' }}>Sign Up</Link>
                        </>
                    )}
                </div>

                {/* Mobile hamburger */}
                <button onClick={() => setMenuOpen(!menuOpen)} className="show-mobile" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'white' : 'var(--charcoal)', padding: '0.5rem' }}>
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        {menuOpen
                            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                        }
                    </svg>
                </button>
            </div>

            {/* Mobile menu */}
            {menuOpen && (
                <div style={{ background: 'white', borderTop: '1px solid var(--border)', padding: '1rem 1.5rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {mobileLink('/', 'Home')}
                    {mobileLink('/services', 'Services')}
                    {user?.role === 'customer' && mobileLink('/book-appointment', 'Book Appointment')}
                    {user?.role === 'customer' && mobileLink('/appointments', 'My Appointments')}
                    {user?.role === 'customer' && mobileLink('/waiting-list', 'Waiting List')}
                    {user?.role === 'provider' && mobileLink('/dashboard', 'Dashboard')}
                    {user?.role === 'admin' && mobileLink('/admin/dashboard', 'Admin Dashboard')}
                    {user?.role === 'admin' && mobileLink('/admin/analytics', 'Analytics')}
                    {user ? (
                        <>
                            {mobileLink('/profile', 'My Profile')}
                            <button onClick={handleLogout} style={{ background: 'none', border: 'none', color: '#ef4444', fontWeight: '600', cursor: 'pointer', textAlign: 'left', padding: 0, fontFamily: 'Inter, sans-serif', fontSize: '1rem' }}>
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            {mobileLink('/login', 'Login')}
                            <Link to="/register" className="btn-primary" style={{ width: 'fit-content' }}>Sign Up</Link>
                        </>
                    )}
                </div>
            )}
        </nav>
    );
};

export default Navbar;