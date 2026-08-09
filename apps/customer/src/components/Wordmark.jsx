import React from 'react';

// The CUSTOMER brand wordmark: lowercase "bookplus" (book ink · plus orange) with
// an orange smile under "plus". Replaces the old calendar squircle mark so the
// in-app logo matches the new brand (and the splash / for-customers logo).
const Wordmark = ({ size = '1.6rem', bookColor = 'var(--charcoal)' }) => (
    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, display: 'inline-flex', alignItems: 'baseline' }}>
        <span style={{ color: bookColor }}>book</span>
        <span style={{ position: 'relative', display: 'inline-block', color: 'var(--gold)' }}>
            plus
            <svg viewBox="0 0 120 24" aria-hidden="true" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: '-0.36em', width: '92%', height: 'auto', overflow: 'visible' }}>
                <path d="M4 5 Q 60 13 116 5 Q 60 23 4 5 Z" fill="var(--gold)" />
            </svg>
        </span>
    </span>
);

export default Wordmark;
