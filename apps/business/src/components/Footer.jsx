import React from 'react';
import { useLocation } from 'react-router-dom';

// The legal + about pages live once, on the customer marketplace site. The
// business app has no routes for them (it's an app, not a website), so linking
// there with react-router bounced providers to the dashboard. Point at the
// canonical customer-hosted pages instead, opened in a new tab so the provider
// keeps their place. Same origin pattern used elsewhere (Navbar, ProviderAccount).
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
                    <a href={`${CUSTOMER_URL}/privacy-policy`} style={linkStyle} {...ext}>Privacy Policy</a>
                    <a href={`${CUSTOMER_URL}/terms`} style={linkStyle} {...ext}>Terms of Service</a>
                    <a href="mailto:info@bookplus.pro" style={linkStyle}>info@bookplus.pro</a>
                </nav>
            </div>
        </footer>
    );
};

export default Footer;
