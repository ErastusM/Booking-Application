import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import SuggestionBox from './SuggestionBox';

const Navbar = () => {
    const { user, logout } = useAuthContext();
    const navigate = useNavigate();
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showSuggestion, setShowSuggestion] = useState(false);
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
        document.body.style.overflow = menuOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [menuOpen]);

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
        <Link to={to} onClick={() => setMenuOpen(false)} style={{
            color: isActive(to) ? 'var(--gold-dark)' : 'var(--text-primary)',
            textDecoration: 'none', fontWeight: isActive(to) ? '600' : '500',
            fontSize: '0.95rem', padding: '0.85rem 1.5rem',
            borderBottom: '1px solid var(--border)', display: 'block',
            background: isActive(to) ? 'rgba(201,168,76,0.07)' : 'transparent',
            borderLeft: isActive(to) ? '3px solid var(--gold)' : '3px solid transparent',
        }}>{label}</Link>
    );

    return (
    <>
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
                    {user?.role === 'admin' && navLink('/bkplus-command', 'Dashboard')}
                    {user?.role === 'admin' && navLink('/bkplus-command/insights', 'Analytics')}
                </div>

                {/* Right side */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }} className="hidden-mobile">
                    {user ? (
                        <>
                            <NotificationBell isTransparent={isTransparent} />
                            <Link to={user.role === 'provider' ? '/account' : '/profile'} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: isTransparent ? 'white' : 'var(--text-primary)', fontSize: '0.9rem', fontWeight: '500' }}>
                                <div style={{ width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--charcoal)', fontWeight: '700', fontSize: '0.8rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={user.avatar} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : user.name?.charAt(0).toUpperCase()
                                    }
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

                {/* Desktop suggestion button */}
                {user && (
                    <button onClick={() => { setShowSuggestion(true); }} className="hidden-mobile" title="Send a suggestion" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)', padding: '0.4rem', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'} onMouseLeave={e => e.currentTarget.style.color = isTransparent ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)'}>
                        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                    </button>
                )}

                {/* Mobile hamburger */}
                <button onClick={() => setMenuOpen(!menuOpen)} className="show-mobile" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'white' : 'var(--charcoal)', padding: '0.5rem' }}>
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>
            </div>

            {/* Mobile side drawer */}
            {menuOpen && (
                <>
                    {/* Full-screen backdrop */}
                    <div
                        onClick={() => setMenuOpen(false)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001, backdropFilter: 'blur(2px)' }}
                    />
                    {/* Drawer panel — slides in from the left */}
                    <div style={{
                        position: 'fixed', top: 0, left: 0, bottom: 0,
                        width: '280px', maxWidth: '85vw',
                        background: darkMode ? '#12121c' : 'white',
                        zIndex: 1002,
                        display: 'flex', flexDirection: 'column',
                        boxShadow: '8px 0 40px rgba(0,0,0,0.2)',
                        overflowY: 'auto',
                        animation: 'slideInLeft 0.22s ease-out',
                    }}>
                        {/* Drawer header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                            <Link to="/" onClick={() => setMenuOpen(false)} style={{ textDecoration: 'none' }}>
                                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.4rem', fontWeight: '700', color: 'var(--gold)', letterSpacing: '-0.02em' }}>
                                    Book<span style={{ color: 'var(--charcoal)' }}>plus</span>
                                </span>
                            </Link>
                            <button onClick={() => setMenuOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.6rem', lineHeight: 1, minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* User badge */}
                        {user && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.5rem', background: 'rgba(201,168,76,0.07)', borderBottom: '1px solid var(--border)' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--charcoal)', fontWeight: '700', fontSize: '0.9rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={user.avatar} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : user.name?.charAt(0).toUpperCase()
                                    }
                                </div>
                                <div>
                                    <p style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--charcoal)', margin: 0 }}>{user.name}</p>
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, textTransform: 'capitalize' }}>{user.role}</p>
                                </div>
                            </div>
                        )}

                        {/* Nav links */}
                        <div style={{ flex: 1, padding: '0.75rem 0' }}>
                            {mobileLink('/', 'Home')}
                            {mobileLink('/services', 'Services')}
                            {user?.role === 'customer' && mobileLink('/book-appointment', 'Book Appointment')}
                            {user?.role === 'customer' && mobileLink('/appointments', 'My Appointments')}
                            {user?.role === 'customer' && mobileLink('/waiting-list', 'Waiting List')}
                            {user?.role === 'provider' && mobileLink('/dashboard', 'Dashboard')}
                            {user?.role === 'admin' && mobileLink('/bkplus-command', 'Dashboard')}
                            {user?.role === 'admin' && mobileLink('/bkplus-command/insights', 'Analytics')}
                            {user && mobileLink(user.role === 'provider' ? '/account' : '/profile', 'My Profile')}
                        </div>

                        {/* Bottom actions */}
                        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {user ? (
                                <button onClick={handleLogout} style={{ width: '100%', padding: '0.75rem', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontWeight: '600', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: '0.9rem' }}>
                                    Logout
                                </button>
                            ) : (
                                <>
                                    {mobileLink('/login', 'Login')}
                                    <Link to="/register" onClick={() => setMenuOpen(false)} className="btn-primary" style={{ width: '100%', padding: '0.85rem', textAlign: 'center', textDecoration: 'none' }}>Sign Up</Link>
                                </>
                            )}
                        </div>
                    </div>
                </>
            )}
        </nav>

        {/* Mobile bottom navigation bar — only for logged-in users */}
        {user && (
            <div className="show-mobile" style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999,
                background: 'white', borderTop: '1px solid var(--border)',
                boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
                display: 'flex', alignItems: 'stretch',
                height: '62px', paddingBottom: 'env(safe-area-inset-bottom)',
            }}>
                {user.role === 'provider' && [
                    { to: '/dashboard?tab=calendar', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    ), label: 'Calendar' },
                    { to: '/dashboard', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                    ), label: 'Dashboard' },
                    { to: '/services', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                    ), label: 'Services' },
                    { to: '/account', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    ), label: 'Account' },
                ].map(({ to, icon, label }) => {
                    const active = location.pathname === to.split('?')[0] && (to === '/dashboard' ? !location.search.includes('tab=') || location.search === '' : true);
                    return (
                        <Link key={to} to={to} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', textDecoration: 'none', color: isActive(to.split('?')[0]) ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: isActive(to.split('?')[0]) ? '700' : '500', fontFamily: 'Outfit, sans-serif', transition: 'color 0.15s' }}>
                            <span style={{ color: isActive(to.split('?')[0]) ? 'var(--gold)' : 'var(--text-muted)', display: 'flex' }}>{icon}</span>
                            {label}
                        </Link>
                    );
                })}
                {user.role === 'customer' && [
                    { to: '/', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                    ), label: 'Home' },
                    { to: '/book-appointment', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                    ), label: 'Book' },
                    { to: '/appointments', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    ), label: 'Bookings' },
                    { to: '/profile', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    ), label: 'Profile' },
                ].map(({ to, icon, label }) => (
                    <Link key={to} to={to} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', textDecoration: 'none', color: isActive(to) ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: isActive(to) ? '700' : '500', fontFamily: 'Outfit, sans-serif', transition: 'color 0.15s' }}>
                        <span style={{ color: isActive(to) ? 'var(--gold)' : 'var(--text-muted)', display: 'flex' }}>{icon}</span>
                        {label}
                    </Link>
                ))}
                <button onClick={() => setShowSuggestion(true)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', color: showSuggestion ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: showSuggestion ? '700' : '500', fontFamily: 'Outfit, sans-serif', padding: 0 }}>
                    <span style={{ color: showSuggestion ? 'var(--gold)' : 'var(--text-muted)', display: 'flex' }}>
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                    </span>
                    Suggest
                </button>
            </div>
        )}
        {user && <SuggestionBox user={user} open={showSuggestion} onClose={() => setShowSuggestion(false)} />}
        {/* Spacer so content doesn't hide behind bottom nav on mobile */}
        {user && <div className="show-mobile" style={{ height: '62px' }} />}
    </>
    );
};

export default Navbar;