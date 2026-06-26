import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import SuggestionBox from './SuggestionBox';
import { cloudinaryAvatar } from '../utils/cloudinary';
import BrandMark from './BrandMark';

const Navbar = () => {
    const { user, logout, activeRole, switchRole } = useAuthContext();
    const { darkMode, toggleDarkMode } = useTheme();
    const navigate = useNavigate();
    const location = useLocation();
    const [scrolled, setScrolled] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showSuggestion, setShowSuggestion] = useState(false);

    const isHome = location.pathname === '/';
    // The transparent navbar uses white text/icons, which only reads on a DARK hero.
    // The home hero is light in light mode, so only go transparent in dark mode —
    // otherwise the white icons vanish against the light hero (scrolled-to-top bug).
    const isTransparent = isHome && !scrolled && darkMode;

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
    // Hide the bottom nav while booking so it can't cover the sticky "Confirm booking" bar.
    const onBookingPage = location.pathname === '/book-appointment';

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
        paddingTop: 'env(safe-area-inset-top, 0px)',
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
        {/* Dark backdrop behind the status bar so its white text stays legible in light mode too (installed PWA).
            Height is the safe-area inset, so it collapses to nothing in a normal browser. */}
        <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'env(safe-area-inset-top, 0px)', background: darkMode ? '#0f0f1a' : '#1a1a2e', zIndex: 1300, pointerEvents: 'none' }} />
        <nav style={navStyles}>
            <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>

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
                    {navLink('/about', 'About us')}
                    {activeRole === 'customer' && navLink('/book-appointment', 'Book')}
                    {activeRole === 'customer' && navLink('/appointments', 'Appointments')}
                    {activeRole === 'customer' && navLink('/wallet', 'Wallet')}
                    {activeRole === 'customer' && navLink('/waiting-list', 'Waiting List')}
                    {activeRole === 'customer' && user?.role === 'customer' && navLink('/become-provider', 'List your business')}
                    {activeRole === 'provider' && navLink('/dashboard', 'Dashboard')}
                    {activeRole === 'provider' && navLink('/appointments', 'My bookings')}
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
                            {/* Role switcher — only visible for provider accounts */}
                            {user.role === 'provider' && (
                                <div style={{ display: 'flex', background: isTransparent ? 'rgba(255,255,255,0.12)' : 'var(--warm-gray,#f4f4f0)', borderRadius: '99px', border: `1px solid ${isTransparent ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`, padding: '3px', gap: '2px' }}>
                                    {['provider', 'customer'].map(r => (
                                        <button
                                            key={r}
                                            onClick={() => switchRole(r)}
                                            style={{
                                                padding: '4px 12px', borderRadius: '99px', border: 'none',
                                                cursor: 'pointer', fontSize: '0.72rem', fontWeight: '600',
                                                fontFamily: 'Plus Jakarta Sans, sans-serif', textTransform: 'capitalize',
                                                transition: 'all 0.15s',
                                                background: activeRole === r ? (isTransparent ? 'rgba(255,255,255,0.9)' : 'var(--charcoal,#1a1a2e)') : 'transparent',
                                                color: activeRole === r ? (isTransparent ? 'var(--charcoal,#1a1a2e)' : 'var(--gold,#c9a84c)') : (isTransparent ? 'rgba(255,255,255,0.65)' : 'var(--text-muted)'),
                                            }}
                                        >{r === 'provider' ? '🏢 Business' : '👤 Customer'}</button>
                                    ))}
                                </div>
                            )}
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
                            <Link to={activeRole === 'provider' ? '/account' : '/profile'} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: isTransparent ? 'white' : 'var(--text-primary)', fontSize: '0.9rem', fontWeight: '500' }}>
                                <div style={{ width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.8rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={cloudinaryAvatar(user.avatar)} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                                fontFamily: 'Plus Jakarta Sans, sans-serif', transition: 'all 0.2s ease',
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

                {/* Mobile right cluster — notifications + suggestion + menu (both roles) */}
                <div className="show-mobile" style={{ alignItems: 'center', gap: '0.1rem' }}>
                    {user && <NotificationBell isTransparent={isTransparent} />}
                    {/* Customers reach Suggest from the bottom nav, so the top icon is provider-only to avoid a duplicate */}
                    {user && activeRole !== 'customer' && (
                        <button
                            onClick={() => setShowSuggestion(true)}
                            aria-label="Send a suggestion"
                            title="Send a suggestion"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'white' : 'var(--text-secondary)', padding: '0.5rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                    )}
                    <button
                        onClick={() => setMenuOpen(prev => !prev)}
                        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: isTransparent ? 'white' : 'var(--charcoal)', padding: '0.5rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            {menuOpen
                                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
                        </svg>
                    </button>
                </div>
            </div>
        </nav>

        {/* Mobile side drawer */}
        {menuOpen && (
            <>
                <div onClick={() => setMenuOpen(false)} className="show-mobile" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.44)', zIndex: 1200, backdropFilter: 'blur(2px)' }} />
                <aside className="show-mobile mobile-drawer" style={{
                    position: 'fixed', top: 0, left: 0, bottom: 0,
                    paddingTop: 'env(safe-area-inset-top, 0px)',
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
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
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
                        <div style={{ background: 'rgba(201,168,76,0.07)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.2rem' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.9rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={cloudinaryAvatar(user.avatar)} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : user.name?.charAt(0).toUpperCase()
                                    }
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--charcoal)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</p>
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{activeRole === 'provider' ? 'Business' : 'Customer'} mode</p>
                                </div>
                            </div>
                            {/* Role switcher pill — only for provider accounts */}
                            {user.role === 'provider' && (
                                <div style={{ display: 'flex', gap: '0.5rem', padding: '0 1.2rem 0.85rem' }}>
                                    {['provider', 'customer'].map(r => (
                                        <button
                                            key={r}
                                            onClick={() => { switchRole(r); setMenuOpen(false); }}
                                            style={{
                                                flex: 1, padding: '0.42rem', borderRadius: '99px',
                                                border: `1.5px solid ${activeRole === r ? 'var(--gold)' : 'var(--border)'}`,
                                                background: activeRole === r ? 'rgba(201,168,76,0.12)' : 'transparent',
                                                color: activeRole === r ? 'var(--gold-dark,#a07830)' : 'var(--text-muted)',
                                                fontSize: '0.75rem', fontWeight: '600',
                                                fontFamily: 'Plus Jakarta Sans, sans-serif', textTransform: 'capitalize',
                                                cursor: 'pointer',
                                            }}
                                        >{r === 'provider' ? '🏢 Business' : '👤 Customer'}</button>
                                    ))}
                                </div>
                            )}
                            {/* Customers get an explicit switch-to-providing entry here too */}
                            {user.role === 'customer' && (
                                <div style={{ padding: '0 1.2rem 0.85rem' }}>
                                    <button
                                        onClick={() => { setMenuOpen(false); navigate('/become-provider'); }}
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '99px', border: '1.5px solid var(--gold)', background: 'rgba(201,168,76,0.12)', color: 'var(--gold-dark,#a07830)', fontSize: '0.78rem', fontWeight: '600', fontFamily: 'Plus Jakarta Sans, sans-serif', cursor: 'pointer' }}
                                    >Become a Business →</button>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ flex: 1, padding: '0.6rem 0' }}>
                        {mobileLink('/', 'Home')}
                        {mobileLink('/services', 'Services')}
                        {mobileLink('/about', 'About us')}
                        {activeRole === 'customer' && mobileLink('/book-appointment', 'Book Appointment')}
                        {activeRole === 'customer' && mobileLink('/appointments', 'My Appointments')}
                        {activeRole === 'customer' && mobileLink('/wallet', 'Wallet')}
                        {activeRole === 'customer' && mobileLink('/waiting-list', 'Waiting List')}
                        {activeRole === 'customer' && user?.role === 'customer' && mobileLink('/become-provider', 'List your business')}
                        {activeRole === 'provider' && mobileLink('/dashboard', 'Dashboard')}
                        {activeRole === 'provider' && mobileLink('/appointments', 'My bookings')}
                        {user?.role === 'admin' && mobileLink('/bkplus-command', 'Dashboard')}
                        {user?.role === 'admin' && mobileLink('/bkplus-command/insights', 'Analytics')}
                        {user && mobileLink(activeRole === 'provider' ? '/account' : '/profile', 'My Profile')}
                    </div>

                    {/* Suggest a feature — pinned to the bottom, above the toggle */}
                    {user && (
                        <button
                            onClick={() => { setMenuOpen(false); setShowSuggestion(true); }}
                            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', padding: '0.95rem 1.2rem', fontSize: '0.95rem', color: 'var(--text-primary)', fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
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
                            <button onClick={handleLogout} style={{ width: '100%', padding: '0.78rem', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontWeight: '600', cursor: 'pointer', fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: '0.9rem' }}>
                                Logout
                            </button>
                        </div>
                    )}
                </aside>
            </>
        )}

        {/* Mobile bottom navigation — provider: floating rounded card (matches design mock) */}
        {user && activeRole === 'provider' && !onBookingPage && (
            <div className="show-mobile" style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 999,
                display: 'flex', justifyContent: 'center',
                padding: '0 12px calc(3px + env(safe-area-inset-bottom, 0))',
                pointerEvents: 'none',
            }}>
                <div style={{
                    pointerEvents: 'auto', width: '100%', maxWidth: '440px',
                    display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
                    background: darkMode ? 'rgba(22,22,34,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border)',
                    borderRadius: '20px', boxShadow: '0 8px 22px rgba(26,26,46,0.13)',
                    padding: '7px 6px 6px',
                }}>
                    {[
                        { to: '/dashboard', label: 'Calendar', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                        ) },
                        { to: '/dashboard?tab=waitlist', label: 'Waiting List', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.75"/></svg>
                        ) },
                        { to: '/dashboard?tab=earnings', label: 'Earnings', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        ) },
                        { to: '/account', label: 'Account', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                        ) },
                    ].map(({ to, icon, label }) => {
                        const [toPath, toQs] = to.split('?');
                        const toTab = toQs ? new URLSearchParams(toQs).get('tab') : null;
                        const curTab = new URLSearchParams(location.search).get('tab');
                        // Calendar (no tab) is the dashboard default — it stays active for any tab that isn't another nav item's.
                        const active = location.pathname === toPath && (toTab ? curTab === toTab : !(toPath === '/dashboard' && (curTab === 'earnings' || curTab === 'waitlist')));
                        return (
                            <Link key={to} to={to} aria-label={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', textDecoration: 'none', minWidth: 0, WebkitTapHighlightColor: 'transparent' }}>
                                <span style={{
                                    width: '38px', height: '38px', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: active ? 'rgba(201,168,76,0.20)' : 'rgba(201,168,76,0.09)',
                                    color: active ? 'var(--gold-dark)' : 'var(--gold)',
                                    transition: 'background 0.18s ease, color 0.18s ease',
                                }}>{icon}</span>
                                <span style={{
                                    fontSize: '0.6rem', fontWeight: active ? '700' : '500',
                                    color: active ? 'var(--gold-dark)' : 'var(--text-muted)',
                                    fontFamily: 'Plus Jakarta Sans, sans-serif', whiteSpace: 'nowrap', lineHeight: 1.1,
                                }}>{label}</span>
                                <span style={{ width: '16px', height: '2px', borderRadius: '99px', background: active ? 'var(--gold)' : 'transparent', transition: 'background 0.18s ease' }} />
                            </Link>
                        );
                    })}
                </div>
            </div>
        )}

        {/* Mobile bottom navigation — customer: floating rounded card (matches the provider one so it doesn't bleed to the edges) */}
        {user && activeRole === 'customer' && !onBookingPage && (
            <div className="show-mobile" style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 999,
                display: 'flex', justifyContent: 'center',
                padding: '0 12px calc(3px + env(safe-area-inset-bottom, 0))',
                pointerEvents: 'none',
            }}>
                <div style={{
                    pointerEvents: 'auto', width: '100%', maxWidth: '460px',
                    display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
                    background: darkMode ? 'rgba(22,22,34,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border)',
                    borderRadius: '20px', boxShadow: '0 8px 22px rgba(26,26,46,0.13)',
                    padding: '7px 4px 6px',
                }}>
                    {[
                        { to: '/', label: 'Home', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                        ) },
                        { to: '/services', label: 'Book', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
                        ) },
                        { to: '/appointments', label: 'Bookings', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                        ) },
                        { to: '/profile', label: 'Profile', icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                        ) },
                        { action: () => setShowSuggestion(true), label: 'Suggest', activeOverride: showSuggestion, icon: (
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                        ) },
                    ].map(({ to, action, icon, label, activeOverride }) => {
                        const active = activeOverride !== undefined ? activeOverride : isActive(to);
                        const itemStyle = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', textDecoration: 'none', minWidth: 0, WebkitTapHighlightColor: 'transparent', background: 'none', border: 'none', cursor: 'pointer', padding: 0 };
                        const inner = (
                            <>
                                <span style={{
                                    width: '38px', height: '38px', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: active ? 'rgba(201,168,76,0.20)' : 'rgba(201,168,76,0.09)',
                                    color: active ? 'var(--gold-dark)' : 'var(--gold)',
                                    transition: 'background 0.18s ease, color 0.18s ease',
                                }}>{icon}</span>
                                <span style={{
                                    fontSize: '0.6rem', fontWeight: active ? '700' : '500',
                                    color: active ? 'var(--gold-dark)' : 'var(--text-muted)',
                                    fontFamily: 'Plus Jakarta Sans, sans-serif', whiteSpace: 'nowrap', lineHeight: 1.1,
                                }}>{label}</span>
                                <span style={{ width: '16px', height: '2px', borderRadius: '99px', background: active ? 'var(--gold)' : 'transparent', transition: 'background 0.18s ease' }} />
                            </>
                        );
                        return action
                            ? <button key={label} onClick={action} aria-label={label} style={itemStyle}>{inner}</button>
                            : <Link key={to} to={to} aria-label={label} style={itemStyle}>{inner}</Link>;
                    })}
                </div>
            </div>
        )}
        {user && <SuggestionBox user={user} open={showSuggestion} onClose={() => setShowSuggestion(false)} />}
        {user && !onBookingPage && <div className="show-mobile" style={{ height: (activeRole === 'provider' || activeRole === 'customer') ? '88px' : '0px' }} />}
    </>
    );
};

export default Navbar;
