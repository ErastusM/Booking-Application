import React from 'react';
import { openConsentSettings } from '@bookplus/api-client';
import { Link } from 'react-router-dom';
import { COMPANY, companyValue } from '@bookplus/config/legal/company.mjs';

// App-wide footer — keeps the legal pages reachable from anywhere, signed in or not.
const Footer = () => {

    const linkStyle = { color: 'var(--text-secondary)', textDecoration: 'none', fontSize: '0.85rem', fontFamily: 'var(--font-body)' };

    return (
        <footer style={{ borderTop: '1px solid var(--border)', background: 'var(--card-bg)', marginTop: '2rem' }}>
            <div className="container" style={{ padding: '0.85rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>
                    © {new Date().getFullYear()} {companyValue('legalName') || 'Bookplus'}
                </div>
                <nav aria-label="Footer" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
                    <Link to="/about" style={linkStyle}>About us</Link>
                    <Link to="/privacy-policy" style={linkStyle}>Privacy Policy</Link>
                    <Link to="/terms" style={linkStyle}>Terms of Service</Link>
                    <Link to="/legal" style={linkStyle}>Who we are</Link>
                    <a href={`mailto:${COMPANY.email}`} style={linkStyle}>{COMPANY.email}</a>
                    <button type="button" onClick={openConsentSettings} data-testid="cookie-settings-link" style={{ ...linkStyle, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>Cookie settings</button>
                </nav>
            </div>
        </footer>
    );
};

export default Footer;
