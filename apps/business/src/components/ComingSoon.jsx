import React from 'react';

// "Coming soon" state for a feature that is switched off for now (FEATURES in
// @bookplus/config) — the client wallet, while every client pays at the
// appointment. Children render under the message (e.g. read-only balances).
const ComingSoon = ({ title, line, children, testId = 'coming-soon' }) => (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '640px' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.5rem 1.25rem', textAlign: 'center' }}>
            <span style={{ display: 'inline-block', marginBottom: '0.6rem', padding: '0.15rem 0.6rem', borderRadius: '99px', background: 'var(--warm-gray)', color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Coming soon</span>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 600, color: 'var(--charcoal)', margin: '0 0 0.35rem' }}>{title}</h2>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: 1.5 }}>{line}</p>
        </div>
        {children}
    </div>
);

// "Soon" pill for menu items.
export const SoonBadge = () => (
    <span style={{ marginLeft: '0.45rem', padding: '0.05rem 0.45rem', borderRadius: '99px', background: 'var(--warm-gray)', color: 'var(--text-secondary)', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', verticalAlign: '1px' }}>Soon</span>
);

export default ComingSoon;
