import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import SuggestionBox from './SuggestionBox';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { BrandMark } from '@bookplus/ui';

const BUSINESS_URL = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';

// The customer app is ALWAYS the customer experience. Provider/admin accounts
// manage their business on the business app — switching is a hard navigation
// (window.location) so the other app boots fresh with its own data.
const goToBusinessApp = (path = '/dashboard') => { window.location.href = `${BUSINESS_URL}${path}`; };

const Navbar = () => {
    const { user, logout } = useAuthContext();
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

    const navLink = (to, label) => {
        const active = isActive(to);
        const baseColor = active ? 'var(--gold-dark)' : isTransparent ? 'rgba(255,255,255,0.92)' : 'var(--text-secondary)';
        return (
            <Link to={to} className="nav-pill" style={{
                color: baseColor,
                fontWeight: active ? '600' : '500',
                background: active ? (isTransparent ? 'rgba(255,255,255,0.14)' : 'rgba(240,62,22,0.12)') : 'transparent',
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
        background: isTransparent ? 'transparent' : darkMode ? 'rgba(10,10,11,0.97)' : 'rgba(255,255,255,0.97)',
        backdropFilter: isTransparent ? 'none' : 'blur(12px)',
        boxShadow: isTransparent ? 'none' : 'var(--shadow-sm)',
        borderBottom: isTransparent ? 'none' : '1px solid var(--border)',
        color: isTransparent ? 'white' : 'var(--text-primary)',
    };

    // Drawer rows share one left edge (1.2rem) so labels and the icon rows
    // at the bottom line up — mismatched indents read as broken.
    const mobileLink = (to, label) => (
        <Link to={to} onClick={() => setMenuOpen(false)} style={{
            color: isActive(to) ? 'var(--gold-dark)' : 'var(--text-primary)',
            textDecoration: 'none', fontWeight: isActive(to) ? '600' : '500',
            fontSize: '0.95rem', padding: '0.85rem 1.2rem',
            borderBottom: '1px solid var(--border)', display: 'block',
            background: isActive(to) ? 'rgba(240,62,22,0.07)' : 'transparent',
            borderLeft: isActive(to) ? '3px solid var(--gold)' : '3px solid transparent',
        }}>{label}</Link>
    );

    return (
    <>
        {/* Dark backdrop behind the status bar so its white text stays legible in light mode too (installed PWA).
            Height is the safe-area inset, so it collapses to nothing in a normal browser. */}
        <div aria-hidden="true" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'env(safe-area-inset-top, 0px)', background: darkMode ? '#0a0a0b' : '#040505', zIndex: 1300, pointerEvents: 'none' }} />
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
                    {user && navLink('/book-appointment', 'Book')}
                    {user && navLink('/appointments', 'Appointments')}
                    {user && navLink('/wallet', 'Wallet')}
                    {user && navLink('/waiting-list', 'Waiting List')}
                    {user?.role === 'customer' && navLink('/become-provider', 'List your business')}
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
                            {/* Business accounts manage their business on the business app */}
                            {(user.role === 'provider' || user.role === 'admin') && (
                                <button
                                    onClick={() => goToBusinessApp(user.role === 'admin' ? '/bkplus-command' : '/dashboard')}
                                    title="Open the business app"
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                        padding: '0.42rem 0.9rem', borderRadius: '99px',
                                        border: '1.5px solid var(--gold)', cursor: 'pointer',
                                        background: 'rgba(240,62,22,0.10)', color: isTransparent ? 'white' : 'var(--gold-dark)',
                                        fontSize: '0.78rem', fontWeight: '700', fontFamily: 'var(--font-body)',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg>
                                    Business
                                </button>
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
                            <Link to="/profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: isTransparent ? 'white' : 'var(--text-primary)', fontSize: '0.9rem', fontWeight: '500' }}>
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
                                fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
                            }}
                                onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
                                onMouseLeave={e => { e.target.style.borderColor = isTransparent ? 'rgba(255,255,255,0.4)' : 'var(--border)'; e.target.style.color = isTransparent ? 'white' : 'var(--text-secondary)'; }}
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            <a href={BUSINESS_URL} style={{ color: isTransparent ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: '600', transition: 'color 0.2s' }} onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'} onMouseLeave={e => e.currentTarget.style.color = isTransparent ? 'rgba(255,255,255,0.85)' : 'var(--text-secondary)'}>For business</a>
                            <Link to="/login" style={{ color: isTransparent ? 'white' : 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: '500', transition: 'color 0.2s' }}>Login</Link>
                            <Link to="/register" className="btn-primary" style={{ padding: '0.5rem 1.25rem' }}>Sign Up</Link>
                        </>
                    )}
                </div>

                {/* Mobile right cluster — notifications + menu */}
                <div className="show-mobile" style={{ alignItems: 'center', gap: '0.1rem' }}>
                    {user && <NotificationBell isTransparent={isTransparent} />}
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
                            <a href={BUSINESS_URL} style={{ width: '100%', textAlign: 'center', textDecoration: 'none', padding: '0.7rem 1rem', color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.9rem' }}>List your business →</a>
                        </div>
                    )}

                    {user && (
                        <div style={{ background: 'rgba(240,62,22,0.07)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 1.2rem' }}>
                                <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.9rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={cloudinaryAvatar(user.avatar)} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : user.name?.charAt(0).toUpperCase()
                                    }
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <p style={{ fontWeight: '600', fontSize: '0.9rem', color: 'var(--charcoal)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</p>
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Customer</p>
                                </div>
                            </div>
                            {/* Business accounts hop to the business app — a hard navigation
                                so the other app loads fresh with business data. */}
                            {(user.role === 'provider' || user.role === 'admin') && (
                                <div style={{ padding: '0 1.2rem 0.85rem' }}>
                                    <button
                                        onClick={() => goToBusinessApp(user.role === 'admin' ? '/bkplus-command' : '/dashboard')}
                                        style={{ width: '100%', padding: '0.55rem', borderRadius: '99px', border: '1.5px solid var(--gold)', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark,#b32c0d)', fontSize: '0.78rem', fontWeight: '700', fontFamily: 'var(--font-body)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem' }}
                                    >
                                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg>
                                        Open the Business app →
                                    </button>
                                </div>
                            )}
                            {user.role === 'customer' && (
                                <div style={{ padding: '0 1.2rem 0.85rem' }}>
                                    <button
                                        onClick={() => { setMenuOpen(false); navigate('/become-provider'); }}
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '99px', border: '1.5px solid var(--gold)', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark,#b32c0d)', fontSize: '0.78rem', fontWeight: '600', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                                    >Become a Business →</button>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ flex: 1, padding: '0.6rem 0' }}>
                        {mobileLink('/', 'Home')}
                        {mobileLink('/services', 'Services')}
                        {mobileLink('/about', 'About us')}
                        {user && mobileLink('/book-appointment', 'Book Appointment')}
                        {user && mobileLink('/appointments', 'My Appointments')}
                        {user && mobileLink('/wallet', 'Wallet')}
                        {user && mobileLink('/waiting-list', 'Waiting List')}
                        {user?.role === 'customer' && mobileLink('/become-provider', 'List your business')}
                        {user && mobileLink('/profile', 'My Profile')}
                    </div>

                    {/* Suggest a feature — pinned to the bottom, above the toggle */}
                    {user && (
                        <button
                            onClick={() => { setMenuOpen(false); setShowSuggestion(true); }}
                            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer', padding: '0.95rem 1.2rem', fontSize: '0.95rem', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
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
                            <button onClick={handleLogout} style={{ width: '100%', padding: '0.78rem', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontWeight: '600', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>
                                Logout
                            </button>
                        </div>
                    )}
                </aside>
            </>
        )}

        {/* Mobile bottom navigation — one customer nav for every signed-in user */}
        {user && (
            <div className="show-mobile" style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 999,
                display: 'flex', justifyContent: 'center',
                padding: '0 12px calc(3px + env(safe-area-inset-bottom, 0))',
                pointerEvents: 'none',
            }}>
                <div style={{
                    pointerEvents: 'auto', width: '100%', maxWidth: '460px',
                    display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
                    background: darkMode ? 'rgba(20,20,22,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border)',
                    borderRadius: '20px', boxShadow: '0 8px 22px rgba(4,5,5,0.13)',
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
                                    background: active ? 'rgba(240,62,22,0.20)' : 'rgba(240,62,22,0.09)',
                                    color: active ? 'var(--gold-dark)' : 'var(--gold)',
                                    transition: 'background 0.18s ease, color 0.18s ease',
                                }}>{icon}</span>
                                <span style={{
                                    fontSize: '0.6rem', fontWeight: active ? '700' : '500',
                                    color: active ? 'var(--gold-dark)' : 'var(--text-muted)',
                                    fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', lineHeight: 1.1,
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
    </>
    );
};

export default Navbar;
