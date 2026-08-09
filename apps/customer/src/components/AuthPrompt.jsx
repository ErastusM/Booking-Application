import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, UserPlus, User, X } from 'lucide-react';
import { useModalChrome } from '../hooks/useModalChrome';

/**
 * Shown when a signed-out visitor hits something that needs an account — instead
 * of leaking the API's raw 401 ("No token, authorization denied") into an error
 * banner. It says WHY an account is needed and offers the real ways forward.
 *
 * `allowGuest` is only passed where guest checkout genuinely works (booking).
 * A waiting list can't take guests: the entry is keyed to a real customer so we
 * can reach them the moment a slot frees up — so there we offer log in / sign up
 * only, rather than dangling an option that would fail.
 *
 * `next` is the path to come back to after auth, so signing in never throws away
 * what the visitor was in the middle of.
 */
const AuthPrompt = ({
    title = 'Sign in to continue',
    message,
    allowGuest = false,
    guestLabel = 'Continue as guest',
    onGuest,
    onClose,
    next,
}) => {
    const navigate = useNavigate();
    const panelRef = useModalChrome(() => onClose?.());
    const go = (path) => navigate(next ? `${path}?next=${encodeURIComponent(next)}` : path);

    const actionStyle = {
        width: '100%', padding: '0.85rem', display: 'inline-flex', alignItems: 'center',
        justifyContent: 'center', gap: '0.5rem', marginBottom: '0.6rem',
    };

    return (
        <div
            onClick={() => onClose?.()}
            className="scrim-in"
            style={{ position: 'fixed', inset: 0, background: 'rgba(4,5,5,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '1rem' }}
        >
            <div
                ref={panelRef}
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="auth-prompt-title"
                className="scale-in"
                style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', width: '100%', maxWidth: '400px', boxShadow: '0 20px 60px rgba(4,5,5,0.3)', outline: 'none' }}
            >
                <div style={{ padding: '1.1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 id="auth-prompt-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>{title}</h2>
                    <button onClick={() => onClose?.()} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '1.25rem' }}>
                    {message && (
                        <p style={{ margin: '0 0 1.1rem', color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6 }}>{message}</p>
                    )}

                    <button type="button" className="btn-primary" style={actionStyle} onClick={() => go('/login')}>
                        <LogIn size={17} strokeWidth={2.2} /> Log in
                    </button>
                    <button type="button" className="btn-outline" style={actionStyle} onClick={() => go('/register')}>
                        <UserPlus size={17} strokeWidth={2.2} /> Create an account
                    </button>

                    {allowGuest && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', margin: '0.9rem 0' }}>
                                <span style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                <span style={{ fontSize: '0.72rem', fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>or</span>
                                <span style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                            </div>
                            <button type="button" className="btn-outline" style={{ ...actionStyle, marginBottom: 0 }} onClick={() => { onClose?.(); onGuest?.(); }}>
                                <User size={17} strokeWidth={2.2} /> {guestLabel}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AuthPrompt;
