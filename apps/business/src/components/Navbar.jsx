import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import SuggestionBox from './SuggestionBox';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { BrandMark } from '@bookplus/ui';

const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'http://localhost:3002';

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

    // Dashboard tabs live in the query string — a link with ?tab= is active only
    // on that tab, and the plain Dashboard link only when no other tab is open.
    const navLink = (to, label) => {
        const [toPath, toQs] = to.split('?');
        const toTab = toQs ? new URLSearchParams(toQs).get('tab') : null;
        const curTab = new URLSearchParams(location.search).get('tab');
        const active = location.pathname === toPath
            && (toTab ? curTab === toTab : !(toPath === '/dashboard' && (curTab === 'earnings' || curTab === 'waitlist')));
        const baseColor = active ? 'var(--gold-light)' : 'rgba(255,255,255,0.78)';
        return (
            <Link to={to} className="nav-pill" style={{
                color: baseColor,
                fontWeight: active ? '600' : '500',
                background: active ? 'rgba(240,62,22,0.22)' : 'transparent',
            }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; } }}
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
        // Always-ink chrome: the business product is visually distinct from the
        // customer site at a glance, in both themes.
        background: darkMode ? 'rgba(10,10,11,0.97)' : 'rgba(4,5,5,0.97)',
        backdropFilter: 'blur(12px)',
        boxShadow: 'var(--shadow-sm)',
        borderBottom: '1px solid rgba(255,255,255,0.10)',
        color: '#fff',
    };

    // Drawer rows share one left edge (1.2rem) so labels line up with the
    // icon rows at the bottom of the drawer.
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
                        <span style={{ color: '#fff' }}>Book</span><span style={{ color: 'var(--gold)' }}>plus</span>
                    </span>
                    <span style={{ marginLeft: '0.15rem', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-light)', border: '1px solid rgba(240,62,22,0.5)', borderRadius: '999px', padding: '0.2rem 0.5rem', flexShrink: 0 }}>Business</span>
                </Link>

                {/* Desktop links */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }} className="hidden-mobile">
                    {/* Business app: no marketplace here — providers manage, customers browse
                        on the customer site (cross-app link below). */}
                    <a className="nav-pill" href={CUSTOMER_URL} style={{ color: 'rgba(255,255,255,0.78)', fontWeight: '500' }}>Customer site</a>
                    {user?.role === 'provider' && navLink('/dashboard', 'Dashboard')}
                    {user?.role === 'provider' && navLink('/dashboard?tab=earnings', 'Earnings')}
                    {user?.role === 'provider' && navLink('/dashboard?tab=waitlist', 'Waiting list')}
                    {user?.role === 'provider' && navLink('/team', 'Team')}
                    {user?.role === 'staff' && navLink('/my-schedule', 'My Schedule')}
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
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '0.4rem', display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', transition: 'color 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
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
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)', padding: '0.4rem', display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)', transition: 'color 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.7)'}
                            >
                                <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.9c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0012 2z"/></svg>
                            </button>
                            <NotificationBell isTransparent={isTransparent} />
                            <Link to={user.role === 'provider' ? '/account' : user.role === 'staff' ? '/my-schedule' : '/bkplus-command'} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none', color: '#fff', fontSize: '0.9rem', fontWeight: '500' }}>
                                <div style={{ width: '34px', height: '34px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink)', fontWeight: '700', fontSize: '0.8rem', flexShrink: 0 }}>
                                    {user.avatar
                                        ? <img src={cloudinaryAvatar(user.avatar)} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : user.name?.charAt(0).toUpperCase()
                                    }
                                </div>
                                {user.name?.split(' ')[0]}
                            </Link>
                            <button onClick={handleLogout} style={{
                                // Fixed light colors: this navbar is always ink,
                                // so theme text vars would be dark-on-dark.
                                background: 'transparent', border: '1.5px solid',
                                borderColor: 'rgba(255,255,255,0.35)',
                                color: 'rgba(255,255,255,0.85)',
                                padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer', fontSize: '0.85rem',
                                fontFamily: 'var(--font-body)', transition: 'all 0.2s ease',
                            }}
                                onMouseEnter={e => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
                                onMouseLeave={e => { e.target.style.borderColor = 'rgba(255,255,255,0.35)'; e.target.style.color = 'rgba(255,255,255,0.85)'; }}
                            >
                                Logout
                            </button>
                        </>
                    ) : (
                        <>
                            <Link to="/login" style={{ color: '#fff', textDecoration: 'none', fontSize: '0.9rem', fontWeight: '500', transition: 'color 0.2s' }}>Login</Link>
                            <a href={`${CUSTOMER_URL}/register`} className="btn-primary" style={{ padding: '0.5rem 1.25rem', textDecoration: 'none' }}>Sign Up</a>
                        </>
                    )}
                </div>

                {/* Mobile right cluster — notifications + suggestion + menu */}
                <div className="show-mobile" style={{ alignItems: 'center', gap: '0.1rem' }}>
                    {user && <NotificationBell isTransparent={isTransparent} />}
                    {user && (
                        <button
                            onClick={() => setShowSuggestion(true)}
                            aria-label="Send a suggestion"
                            title="Send a suggestion"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', padding: '0.5rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </button>
                    )}
                    <button
                        onClick={() => setMenuOpen(prev => !prev)}
                        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: '0.5rem', minWidth: '44px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                            <span style={{ marginLeft: '0.1rem', fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--gold-dark)', border: '1px solid rgba(240,62,22,0.5)', borderRadius: '999px', padding: '0.18rem 0.45rem', flexShrink: 0 }}>Business</span>
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
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>Business account</p>
                                </div>
                            </div>
                            {/* Booking as a customer happens on the customer site. */}
                            {user.role === 'provider' && (
                                <div style={{ padding: '0 1.2rem 0.85rem' }}>
                                    <a href={CUSTOMER_URL} style={{ display: 'block', textAlign: 'center', padding: '0.5rem', borderRadius: '99px', border: '1.5px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: '600', textDecoration: 'none' }}>Book as a customer →</a>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ flex: 1, padding: '0.6rem 0' }}>
                        <a href={CUSTOMER_URL} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: '500', fontSize: '0.95rem', padding: '0.85rem 1.2rem', borderBottom: '1px solid var(--border)', borderLeft: '3px solid transparent', display: 'block' }}>Customer site</a>
                        {user?.role === 'provider' && mobileLink('/dashboard', 'Dashboard')}
                        {user?.role === 'provider' && mobileLink('/team', 'Team')}
                        {user?.role === 'staff' && mobileLink('/my-schedule', 'My Schedule')}
                        {user?.role === 'admin' && mobileLink('/bkplus-command', 'Dashboard')}
                        {user?.role === 'admin' && mobileLink('/bkplus-command/insights', 'Analytics')}
                        {user?.role === 'provider' && mobileLink('/account', 'My Account')}
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

        {/* Mobile bottom navigation — provider: floating rounded card (matches design mock) */}
        {user?.role === 'provider' && (
            <div className="show-mobile" style={{
                position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 999,
                display: 'flex', justifyContent: 'center',
                padding: '0 12px calc(3px + env(safe-area-inset-bottom, 0))',
                pointerEvents: 'none',
            }}>
                <div style={{
                    pointerEvents: 'auto', width: '100%', maxWidth: '440px',
                    display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
                    background: darkMode ? 'rgba(20,20,22,0.78)' : 'rgba(255,255,255,0.78)',
                    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid var(--border)',
                    borderRadius: '20px', boxShadow: '0 8px 22px rgba(4,5,5,0.13)',
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
                            </Link>
                        );
                    })}
                </div>
            </div>
        )}

        {user && <SuggestionBox user={user} open={showSuggestion} onClose={() => setShowSuggestion(false)} />}
    </>
    );
};

export default Navbar;
