import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import SuggestionBox from './SuggestionBox';
import BrandMark from './BrandMark';

const Navbar = () => {
    const { user, logout } = useAuthContext();
    const { darkMode, toggleDarkMode } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showSuggestion, setShowSuggestion] = useState(false);

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

    const handleLogout = () => { setMenuOpen(false); logout(); navigate('/'); };
    const isActive = (path) => location.pathname === path;

    const navLink = (to, label) => {
        const active = isActive(to);
        const baseColor = active ? 'var(--gold-dark)' : isTransparent ? 'rgba(255,255,255,0.92)' : 'var(--text-secondary)';
        return (
            <Link to={to} className="nav-pill" style={{
                color: baseColor,
                fontWeight: active ? '600' : '500',
                background: active ? (isTransparent ? 'rgba(255,255,255,0.14)' : 'rgba(201,168,76,0.12)') : 'transparent',
            }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = isTransparent ? 'white' : 'var(--gold-dark)'; e.currentTarget.style.background = isTransparent ? 'rgba(255,255,255,0.10)' : 'var(--surface-sunken)'; } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.color = baseColor; e.currentTarget.style.background = 'transparent'; } }}
            >
                {label}
            </Link>
        );
    };

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
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '64px' }}>

                {/* Logo */}
                <Link to="/" style={{ textDecoration: 'none', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '0.55rem' }}>
                    <BrandMark size={30} />
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
                        <span style={{ color: isTransparent ? 'white' : 'var(--charcoal)' }}>Book</span><span style={{ color: 'var(--gold)' }}>plus</span>
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

                {/* Right side desktop */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }} className="hidden-mobile">
                    {/* Dark mode toggle */}
                    <button
                        onClick={toggleDarkMode}
                        title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', padding: '0.4rem', display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', transition: 'color 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.currentTarget.style.color = isTransparent ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}
                    >
                        {darkMode ? (
                            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                        ) : (
                            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                        )}
                    </button>

                    {user ? (
                        <>
                            <button
                                onClick={() => setShowSuggestion(true)}
                                title="Send a suggestion"
                                aria-label="Send a suggestion"
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)', padding: '0.4rem', display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', transition: 'color 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                                onMouseLeave={e => e.currentTarget.style.color = isTransparent ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)'}
                            >
                                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.9c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>
                            </button>
                            <NotificationBell isTransparent={isTransparent} />
                            <Link to={user.role === 'provider' ? '/account' : '/profile'} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: isTransparent ? 'white' : 'var(--text-primary)', fontSize: '0.9rem', fontWeight: '500' }}>
                                <div style={{ width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.8rem', flexShrink: 0 }}>
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
                                fontFamily: 'Outfit, sans-serif', transition: 'all 0.2s ease',
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
                    <button onClick={() => setShowSuggestion(true)} className="hidden-mobile" title="Send a suggestion" style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)', padding: '0.4rem', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'} onMouseLeave={e => e.currentTarget.style.color = isTransparent ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)'}>
                        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                    </button>
                )}

                {/* Mobile hamburger */}
                <button
                    onClick={() => setMenuOpen(prev => !prev)}
                    className="show-mobile"
                    aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'white' : 'var(--charcoal)', padding: '0.5rem', minWidth: '44px', minHeight: '44px', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        {menuOpen
                            ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
                    </svg>
                </button>
            </div>
        </nav>

        {/* Mobile side drawer */}
        {menuOpen && (
            <>
                <div onClick={() => setMenuOpen(false)} className="show-mobile" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.44)', zIndex: 1200, backdropFilter: 'blur(2px)' }} />
                <aside className="show-mobile mobile-drawer" style={{
                    position: 'fixed', top: 0, left: 0, bottom: 0,
                    width: '86vw', maxWidth: '330px',
                    zIndex: 1201,
                    display: 'flex', flexDirection: 'column',
                    boxShadow: '12px 0 44px rgba(0,0,0,0.24)',
                    overflowY: 'auto',
                    animation: 'slideInLeft 0.22s ease-out',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.1rem 1.2rem', borderBottom: '1px solid var(--border)' }}>
                        <Link to="/" onClick={() => setMenuOpen(false)} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                            <BrandMark size={28} />
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700', letterSpacing: '-0.02em' }}>
                                <span style={{ color: 'var(--charcoal)' }}>Book</span><span style={{ color: 'var(--gold)' }}>plus</span>
                            </span>
                        </Link>
                        <button onClick={() => setMenuOpen(false)} aria-label="Close menu" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.55rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {!user && (
                        <div style={{ padding: '1rem 1.2rem', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                            <Link to="/login" onClick={() => setMenuOpen(false)} style={{ width: '100%', textAlign: 'center', textDecoration: 'none', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', color: 'var(--charcoal)', fontWeight: '600', fontSize: '0.92rem' }}>Log in</Link>
                            <Link to="/register" onClick={() => setMenuOpen(false)} className="btn-primary" style={{ width: '100%', padding: '0.8rem 1rem', textAlign: 'center', textDecoration: 'none' }}>Sign Up</Link>
                        </div>
                    )}

                    {user && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.2rem', background: 'rgba(201,168,76,0.07)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.9rem', flexShrink: 0 }}>
                                {user.avatar
                                    ? <img src={user.avatar} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    : user.name?.charAt(0).toUpperCase()
                                }
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--charcoal)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</p>
                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0, textTransform: 'capitalize' }}>{user.role}</p>
                            </div>
                        </div>
                    )}

                    <div style={{ flex: 1, padding: '0.6rem 0' }}>
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

                    {/* Suggest a feature — pinned to the bottom, above the toggle */}
                    {user && (
                        <button
                            onClick={() => { setMenuOpen(false); setShowSuggestion(true); }}
                            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', padding: '0.95rem 1.2rem', fontSize: '0.95rem', color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
                        >
                            <svg width="16" height="16" fill="none" stroke="var(--text-muted)" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.9c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>
                            Suggest a feature
                        </button>
                    )}

                    {/* Dark mode toggle in drawer */}
                    <div style={{ padding: '0.75rem 1.2rem', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <svg width="16" height="16" fill="none" stroke="var(--text-muted)" strokeWidth="2" viewBox="0 0 24 24">
                                {darkMode
                                    ? <><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></>
                                    : <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                                }
                            </svg>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: '500' }}>
                                {darkMode ? 'Light mode' : 'Dark mode'}
                            </span>
                        </div>
                        <button
                            onClick={toggleDarkMode}
                            aria-label="Toggle dark mode"
                            style={{
                                width: '48px', height: '26px', borderRadius: '99px', border: 'none', cursor: 'pointer',
                                background: darkMode ? 'var(--gold)' : '#d1d5db',
                                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                            }}
                        >
                            <span style={{ position: 'absolute', top: '3px', left: darkMode ? '25px' : '3px', width: '20px', height: '20px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                        </button>
                    </div>

                    {user && (
                        <div style={{ padding: '1rem 1.2rem' }}>
                            <button onClick={handleLogout} style={{ width: '100%', padding: '0.78rem', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontWeight: '600', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: '0.9rem' }}>
                                Logout
                            </button>
                        </div>
                    )}
                </aside>
            </>
        )}

        {/* Mobile bottom navigation bar */}
        {user && (
            <div className="show-mobile bottom-nav" style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 999,
                display: 'flex', alignItems: 'stretch',
                height: '62px', paddingBottom: 'env(safe-area-inset-bottom)',
            }}>
                {user.role === 'provider' && [
                    { to: '/services', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                    ), label: 'Services' },
                    { to: '/dashboard', fab: true, icon: (
                        <svg width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    ), label: 'Dashboard' },
                    { to: '/account', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    ), label: 'Account' },
                ].map(({ to, icon, label, fab }) => {
                    const active = isActive(to.split('?')[0]);
                    if (fab) {
                        return (
                            <Link key={to} to={to} aria-label="Dashboard" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', textDecoration: 'none', position: 'relative' }}>
                                <span style={{
                                    position: 'absolute', top: '-24px',
                                    width: '58px', height: '58px', borderRadius: '50%',
                                    background: 'var(--ink)', color: 'var(--gold)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    boxShadow: '0 8px 20px rgba(26,26,46,0.40)',
                                    border: '4px solid var(--card-bg)',
                                    transition: 'transform var(--dur-fast,0.12s) var(--ease-out, ease)',
                                    transform: active ? 'scale(1.04)' : 'none',
                                }}>{icon}</span>
                                <span style={{ fontSize: '0.62rem', fontWeight: active ? '700' : '600', color: active ? 'var(--gold)' : 'var(--text-secondary)', marginBottom: '7px' }}>{label}</span>
                            </Link>
                        );
                    }
                    return (
                        <Link key={to} to={to} className={`bnav-item ${active ? 'is-active' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', textDecoration: 'none', color: active ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: active ? '700' : '500', fontFamily: 'Outfit, sans-serif' }}>
                            <span className="bnav-icon">{icon}</span>
                            {label}
                        </Link>
                    );
                })}
                {user.role === 'customer' && [
                    { to: '/', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                    ), label: 'Home' },
                    { to: '/services', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                    ), label: 'Book' },
                    { to: '/appointments', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    ), label: 'Bookings' },
                    { to: '/profile', icon: (
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    ), label: 'Profile' },
                ].map(({ to, icon, label }) => {
                    const active = isActive(to);
                    return (
                        <Link key={to} to={to} className={`bnav-item ${active ? 'is-active' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', textDecoration: 'none', color: active ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: active ? '700' : '500', fontFamily: 'Outfit, sans-serif' }}>
                            <span className="bnav-icon">{icon}</span>
                            {label}
                        </Link>
                    );
                })}
                {user.role === 'customer' && (
                <button onClick={() => setShowSuggestion(true)} className={`bnav-item ${showSuggestion ? 'is-active' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px', background: 'none', border: 'none', cursor: 'pointer', color: showSuggestion ? 'var(--gold)' : 'var(--text-muted)', fontSize: '0.62rem', fontWeight: showSuggestion ? '700' : '500', fontFamily: 'Outfit, sans-serif', padding: 0 }}>
                    <span className="bnav-icon">
                        <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                    </span>
                    Suggest
                </button>
                )}
            </div>
        )}
        {user && <SuggestionBox user={user} open={showSuggestion} onClose={() => setShowSuggestion(false)} />}
        {user && <div className="show-mobile" style={{ height: '62px' }} />}
    </>
    );
};

export default Navbar;
