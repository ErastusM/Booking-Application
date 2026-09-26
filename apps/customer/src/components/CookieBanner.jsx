import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent, CONSENT_OPEN_EVENT } from '@bookplus/api-client';

// Cookie / analytics consent. Shown until the visitor chooses, and again
// whenever "Cookie settings" is tapped (footer / account → openConsentSettings).
//
// "Only necessary": sign-in, security and the settings you pick (theme etc.) —
// nothing is tracked. "Accept analytics": Bookplus's own page-visit counts
// (a random id on this device, no advertising, no third parties). The choice is
// kept on this device with the time it was made; withdrawing it deletes the id.
// The two buttons are deliberately equal — refusing is as easy as accepting.
const CookieBanner = () => {
    const [open, setOpen] = useState(() => getConsent() === null);
    const [current, setCurrent] = useState(() => getConsent());

    useEffect(() => {
        const show = () => { setCurrent(getConsent()); setOpen(true); };
        window.addEventListener(CONSENT_OPEN_EVENT, show);
        return () => window.removeEventListener(CONSENT_OPEN_EVENT, show);
    }, []);

    if (!open) return null;

    const choose = (analytics) => {
        setCurrent(setConsent(analytics));
        setOpen(false);
    };

    const btn = { flex: '1 1 0', minWidth: '140px', padding: '0.7rem 1rem', fontSize: '0.88rem' };

    return (
        <div
            role="dialog"
            aria-modal="false"
            aria-labelledby="cookie-banner-title"
            data-testid="cookie-banner"
            style={{
                position: 'fixed', left: '50%', transform: 'translateX(-50%)',
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
                width: 'calc(100% - 24px)', maxWidth: '560px', zIndex: 2400,
                background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                boxShadow: '0 12px 40px rgba(4,5,5,0.22)', padding: '1.1rem 1.2rem', fontFamily: 'var(--font-body)',
            }}
        >
            <h2 id="cookie-banner-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>
                Cookies &amp; analytics
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 0.9rem' }}>
                We use what’s necessary to keep you signed in, keep the app secure and remember your settings.
                With your OK we’d also count page visits to improve Bookplus — our own analytics, no ads and no third parties.
                {' '}<Link to="/privacy-policy" style={{ color: 'var(--gold-dark)', textDecoration: 'underline' }}>Privacy Policy</Link>
                {current && (
                    <span style={{ display: 'block', marginTop: '0.4rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Your current choice: {current.analytics ? 'analytics accepted' : 'only necessary'} (since {new Date(current.at).toLocaleDateString()}).
                    </span>
                )}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
                <button type="button" className="btn-outline" style={btn} onClick={() => choose(false)} data-testid="consent-necessary">
                    Only necessary
                </button>
                <button type="button" className="btn-primary" style={btn} onClick={() => choose(true)} data-testid="consent-analytics">
                    Accept analytics
                </button>
            </div>
        </div>
    );
};

export default CookieBanner;
