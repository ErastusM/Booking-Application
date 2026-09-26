import React from 'react';
import { Link } from 'react-router-dom';

/**
 * The two-panel auth layout the business app's sign-in screens share: an ink
 * brand panel on the left (hidden on phones by .auth-left) and the form on the
 * right. `side` is the left panel's headline; `children` is the form column.
 */
export const AuthSplit = ({ side, sideBody, children, testId }) => (
    <div data-testid={testId} style={{
        minHeight: '100dvh',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        background: 'var(--off-white)',
    }}>
        <div className="auth-left" style={{
            background: 'var(--ink)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '4rem',
            position: 'relative',
            overflow: 'hidden',
        }}>
            <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'radial-gradient(ellipse at 30% 70%, rgba(240,62,22,0.05) 0%, transparent 60%)',
                pointerEvents: 'none',
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
                <Link to="/" style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '1.8rem',
                    fontWeight: 600,
                    color: 'white',
                    textDecoration: 'none',
                    display: 'block',
                    marginBottom: '4rem',
                }}>
                    Book<span style={{ color: 'var(--gold)' }}>plus</span>
                </Link>
                <h2 style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'clamp(2rem, 3vw, 2.8rem)',
                    fontWeight: 600,
                    color: 'white',
                    lineHeight: 1.2,
                    marginBottom: '1.5rem',
                }}>
                    {side}
                </h2>
                {sideBody && (
                    <p style={{
                        color: 'rgba(255,255,255,0.66)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: 300,
                        maxWidth: '340px',
                    }}>
                        {sideBody}
                    </p>
                )}
                <div className="gold-divider" style={{ marginTop: '2rem' }} />
            </div>
        </div>

        <div className="auth-right" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 3rem',
        }}>
            <div style={{ width: '100%', maxWidth: '400px' }} className="fade-up">
                {children}
            </div>
        </div>
    </div>
);

export const AuthTitle = ({ children, testId }) => (
    <h1 data-testid={testId} style={{
        fontFamily: 'var(--font-display)',
        fontSize: '1.9rem',
        fontWeight: 600,
        color: 'var(--charcoal)',
        lineHeight: 1.2,
        margin: '0 0 0.6rem',
    }}>
        {children}
    </h1>
);

export const AuthLead = ({ children }) => (
    <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
        {children}
    </p>
);

const TONES = {
    info: ['var(--info-bg)', 'var(--info-fg)'],
    danger: ['var(--danger-bg)', 'var(--danger-fg)'],
    success: ['var(--success-bg)', 'var(--success-fg)'],
    warning: ['var(--warning-bg)', 'var(--warning-fg)'],
};

export const Notice = ({ tone = 'info', children, testId, role }) => {
    const [bg, fg] = TONES[tone] || TONES.info;
    return (
        <div data-testid={testId} role={role} style={{
            background: bg,
            color: fg,
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-sm)',
            margin: '0 0 1.25rem',
            fontSize: '0.86rem',
            lineHeight: 1.5,
        }}>
            {children}
        </div>
    );
};

export const linkStyle = { color: 'var(--gold-dark)', fontWeight: 600, textDecoration: 'none' };
