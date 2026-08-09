import React, { useState } from 'react';
import { suggestionService } from '../services';
import { cloudinaryAvatar } from '../utils/cloudinary';

const CATEGORIES = ['Feature Request', 'Bug Report', 'Improvement', 'Compliment', 'General'];

const categoryMeta = {
    'Feature Request': { icon: '✨', color: '#4f46e5' },
    'Bug Report':      { icon: '🐛', color: '#dc2626' },
    'Improvement':     { icon: '⚡', color: '#d97706' },
    'Compliment':      { icon: '💛', color: '#16a34a' },
    'General':         { icon: '💬', color: '#6b7280' },
};

const SuggestionBox = ({ user, open: openProp, onClose }) => {
    const [openInternal, setOpenInternal] = useState(false);
    const isControlled = openProp !== undefined;
    const open = isControlled ? openProp : openInternal;
    const doClose = () => { if (isControlled) { onClose?.(); } else { setOpenInternal(false); } };
    const [category, setCategory] = useState('General');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const reset = () => { setCategory('General'); setMessage(''); setSent(false); setError(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (message.trim().length < 10) { setError('Please write at least 10 characters.'); return; }
        setSubmitting(true);
        setError('');
        try {
            await suggestionService.submit({
                category,
                message: message.trim(),
                name: user?.name,
                email: user?.email,
                role: user?.role,
            });
            setSent(true);
        } catch {
            setError('Could not submit — please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            {/* Floating trigger button — desktop only, hidden when controlled from outside */}
            {!isControlled && (
                <button
                    onClick={() => { setOpenInternal(true); reset(); }}
                    title="Send us a suggestion"
                    className="hidden-mobile"
                    style={{
                        position: 'fixed', bottom: '1.5rem', right: '1.5rem',
                        width: '52px', height: '52px', borderRadius: '50%',
                        background: 'var(--ink)', color: 'white',
                        border: '2px solid rgba(240,62,22,0.4)',
                        boxShadow: '0 4px 18px rgba(4,5,5,0.35)',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000, transition: 'transform 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(4,5,5,0.45)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 18px rgba(4,5,5,0.35)'; }}
                >
                    <svg width="22" height="22" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M22 12h-6l-2 3H10l-2-3H2"/><path strokeLinecap="round" strokeLinejoin="round" d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/></svg>
                </button>
            )}

            {/* Drawer overlay — stays mounted so its opacity can fade in/out in sync
                with the panel slide instead of blinking on/off. */}
            <div
                onClick={doClose}
                aria-hidden="true"
                style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1001, backdropFilter: 'blur(2px)',
                    opacity: open ? 1 : 0, visibility: open ? 'visible' : 'hidden',
                    pointerEvents: open ? 'auto' : 'none',
                    transition: 'opacity 0.28s ease, visibility 0.28s ease',
                }}
            />

            {/* Slide-in panel — when closed, visibility:hidden + pointer-events:none +
                aria-hidden pull its controls out of the tab order and the a11y tree,
                so keyboard/SR users can't land on the off-screen form. */}
            <div aria-hidden={!open} style={{
                position: 'fixed', top: 0, right: 0, bottom: 0,
                width: '420px', maxWidth: '95vw',
                background: 'var(--card-bg)', boxShadow: '-8px 0 40px rgba(0,0,0,0.18)',
                zIndex: 1002, transform: open ? 'translateX(0)' : 'translateX(100%)',
                visibility: open ? 'visible' : 'hidden',
                pointerEvents: open ? 'auto' : 'none',
                transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1), visibility 0.28s cubic-bezier(0.4,0,0.2,1)',
                display: 'flex', flexDirection: 'column', overflowY: 'auto',
                paddingTop: 'env(safe-area-inset-top, 0px)',
            }}>
                {/* Header */}
                <div style={{ background: 'var(--ink)', padding: '1.5rem 1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
                    <div>
                        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.4rem', fontWeight: '700', margin: '0 0 0.25rem' }}>Suggestion Box</h2>
                        <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', margin: 0 }}>Help us make Bookplus better</p>
                    </div>
                    <button onClick={doClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1, padding: 0, marginTop: '2px' }}>×</button>
                </div>

                <div style={{ padding: '1.75rem', flex: 1, paddingBottom: 'calc(1.75rem + env(safe-area-inset-bottom, 0px))' }}>
                    {sent ? (
                        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>Thank you!</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>Your suggestion has been sent to our team. We read every message and appreciate you taking the time.</p>
                            <button onClick={() => { reset(); doClose(); }} style={{ background: 'var(--ink)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', padding: '0.65rem 1.5rem', fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: '600', cursor: 'pointer' }}>Close</button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit}>
                            {/* Category selector */}
                            <p style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.65rem' }}>Category</p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                {CATEGORIES.map(cat => {
                                    const meta = categoryMeta[cat];
                                    const active = category === cat;
                                    return (
                                        <button
                                            key={cat} type="button"
                                            onClick={() => setCategory(cat)}
                                            style={{
                                                padding: '0.4rem 0.85rem', borderRadius: '99px',
                                                border: `1.5px solid ${active ? meta.color : 'var(--border)'}`,
                                                background: active ? `${meta.color}14` : 'white',
                                                color: active ? meta.color : 'var(--text-secondary)',
                                                fontSize: '0.8rem', fontWeight: active ? '700' : '400',
                                                cursor: 'pointer', fontFamily: 'var(--font-body)',
                                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            <span>{meta.icon}</span><span>{cat}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Message */}
                            <p style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Your message</p>
                            <textarea
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                placeholder={
                                    category === 'Feature Request' ? "I'd love it if Bookplus could..." :
                                    category === 'Bug Report' ? "When I do X, the following happens..." :
                                    category === 'Improvement' ? "This part could be better: ..." :
                                    category === 'Compliment' ? "I really love how..." :
                                    "Share your thoughts with us..."
                                }
                                rows={6}
                                maxLength={2000}
                                style={{ width: '100%', boxSizing: 'border-box', padding: '0.875rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontFamily: 'var(--font-body)', fontSize: '0.875rem', color: 'var(--charcoal)', resize: 'vertical', outline: 'none', lineHeight: 1.65 }}
                            />
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem', marginBottom: '1.25rem' }}>
                                {error ? <span style={{ color: '#dc2626', fontSize: '0.78rem' }}>{error}</span> : <span />}
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{message.length}/2000</span>
                            </div>

                            {/* Sender info (read-only if logged in) */}
                            {user && (
                                <div style={{ background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gold)', fontWeight: '700', fontSize: '0.85rem', flexShrink: 0 }}>
                                        {user.avatar ? <img src={cloudinaryAvatar(user.avatar)} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : user.name?.[0]?.toUpperCase()}
                                    </div>
                                    <div>
                                        <p style={{ margin: 0, fontWeight: '600', fontSize: '0.85rem', color: 'var(--charcoal)' }}>{user.name}</p>
                                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.email}</p>
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={submitting}
                                style={{ width: '100%', padding: '0.85rem', background: submitting ? '#9ca3af' : 'var(--ink)', color: 'var(--on-ink)', border: 'none', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: '700', cursor: submitting ? 'not-allowed' : 'pointer', letterSpacing: '0.03em', transition: 'background 0.15s' }}
                            >
                                {submitting ? 'Sending...' : 'Send Suggestion'}
                            </button>

                            <p style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                                Sent directly to the Bookplus team &bull; We reply to all feedback
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </>
    );
};

export default SuggestionBox;
