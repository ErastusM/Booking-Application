import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// App-wide footer — keeps the legal pages reachable from anywhere, signed in or not.
const Footer = () => {
    const { pathname } = useLocation();
    // The provider dashboard is a full-height app surface; a footer there just adds noise.
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/bkplus-command')) return null;

    const linkStyle = { color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem', fontFamily: 'var(--font-body)' };

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--card-bg)', marginTop: '2rem' }}>
            <div className="container" style={{ padding: '0.85rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>
                    © {new Date().getFullYear()} Bookplus
                </div>
                <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                    <Link to="/about" style={linkStyle}>About us</Link>
                    <Link to="/privacy-policy" style={linkStyle}>Privacy Policy</Link>
                    <Link to="/terms" style={linkStyle}>Terms of Service</Link>
                    <a href="mailto:info@bookplus.pro" style={linkStyle}>info@bookplus.pro</a>
                </nav>
            </div>
        </footer>
    );
};

export default Footer;
