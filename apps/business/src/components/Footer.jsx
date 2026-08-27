import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// The business app hosts its own PROVIDER-facing legal pages (/terms,
// /privacy-policy) — a provider's obligations differ from a customer's, so the
// marketplace-site copy is the wrong agreement to show here. "About us" has no
// business-app equivalent, so it still points at the customer marketplace site.
const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'https://www.bookplus.pro';

// App-wide footer — keeps the legal pages reachable from anywhere, signed in or not.
const Footer = () => {
    const { pathname } = useLocation();
    // The provider dashboard is a full-height app surface; a footer there just adds noise.
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/bkplus-command')) return null;

    const linkStyle = { color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem', fontFamily: 'var(--font-body)' };
    const ext = { target: '_blank', rel: 'noopener noreferrer' };

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--card-bg)', marginTop: '2rem' }}>
            <div className="container" style={{ padding: '0.85rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>
                    © {new Date().getFullYear()} Bookplus
                </div>
                <nav style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                    <a href={`${CUSTOMER_URL}/about`} style={linkStyle} {...ext}>About us</a>
                    <Link to="/privacy-policy" style={linkStyle}>Privacy Policy</Link>
                    <Link to="/terms" style={linkStyle}>Terms of Service</Link>
                    <a href="mailto:info@bookplus.pro" style={linkStyle}>info@bookplus.pro</a>
                </nav>
            </div>
        </footer>
    );
};

export default Footer;
