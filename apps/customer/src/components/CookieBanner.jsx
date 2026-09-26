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
//
// Layering: it sits BELOW every modal/dialog (z 998; modals are 1100+) and never
// covers a fixed bottom bar — the bottom navigation or the booking flow's
// confirm bar — because it lifts itself above whichever of those is on screen.
//
// `canAutoShow` decides whether it appears by itself for someone who hasn't
// chosen yet (the business app only does that on public pages, for signed-out
// visitors). "Cookie settings" opens it regardless.
const BOTTOM_BARS = 'nav[aria-label="Bottom navigation"], .booking-confirm-mobile';

// Distance from the bottom of the viewport to the top of the highest visible
// fixed bottom bar (0 when there is none).
const bottomBarsHeight = () => {
    let top = window.innerHeight;
    document.querySelectorAll(BOTTOM_BARS).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.width > 0 && getComputedStyle(el).display !== 'none' && r.bottom >= window.innerHeight - 2) {
            top = Math.min(top, r.top);
        }
    });
    return Math.max(0, Math.round(window.innerHeight - top));
};

const CookieBanner = ({ canAutoShow = true }) => {
    const [requested, setRequested] = useState(false); // opened via "Cookie settings"
    const [current, setCurrent] = useState(() => getConsent());
    const [lift, setLift] = useState(0);
    const open = requested || (canAutoShow && current === null);

    useEffect(() => {
        const show = () => { setCurrent(getConsent()); setRequested(true); };
        window.addEventListener(CONSENT_OPEN_EVENT, show);
        return () => window.removeEventListener(CONSENT_OPEN_EVENT, show);
    }, []);

    // Keep clear of the bottom bars while open (they come and go with the route
    // and the viewport width).
    useEffect(() => {
        if (!open) return undefined;
        const measure = () => setLift(bottomBarsHeight());
        measure();
        window.addEventListener('resize', measure);
        const t = setInterval(measure, 500);
        return () => { window.removeEventListener('resize', measure); clearInterval(t); };
    }, [open]);

    if (!open) return null;

    const choose = (analytics) => {
        setCurrent(setConsent(analytics));
        setRequested(false);
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
                bottom: lift ? `${lift + 8}px` : 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
                width: 'calc(100% - 24px)', maxWidth: '560px', zIndex: 998,
                maxHeight: `calc(100dvh - ${lift + 80}px)`, overflowY: 'auto',
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
