import React from 'react';

// The BUSINESS brand wordmark: "Bookplus" (Book · plus orange) with an orange
// underline under "plus". Matches the new brand / for-business logo (the "Business"
// pill next to it in the navbar carries the "for business" distinction).
const Wordmark = ({ size = '1.6rem', bookColor = 'var(--charcoal)' }) => (
    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: size, letterSpacing: '-0.03em', lineHeight: 1, display: 'inline-flex', alignItems: 'baseline' }}>
        <span style={{ color: bookColor }}>Book</span>
        <span style={{ position: 'relative', display: 'inline-block', color: 'var(--gold)' }}>
            plus
            <span style={{ position: 'absolute', left: '28%', right: '28%', bottom: '-0.28em', height: '0.09em', minHeight: '2px', borderRadius: '99px', background: 'var(--gold)' }} />
        </span>
    </span>
);

export default Wordmark;
