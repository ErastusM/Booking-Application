import React, { useEffect, useState } from 'react';
import { useAuthContext } from '../context/AuthContext';
import API from '../services/api';

// Backup flag so the prompt never re-shows after submit/dismiss even if the
// signupSurvey write on the user record hasn't round-tripped back into the
// cached /auth/profile response yet (or the request itself failed).
const DISMISSED_KEY = 'bp_customer_signup_survey_done';

// One-time, in-app "how was signing up?" prompt. Mounts app-wide (like
// WaitlistCelebration) and shows itself the moment a logged-in customer's
// user record has no signupSurvey yet — which, in practice, is their first
// authenticated session after finishing signup (immediately for Google
// sign-up, or after verifying email and logging in for email/password).
const SignupSurveyModal = () => {
    const { user, setUser } = useAuthContext();
    const [open, setOpen] = useState(false);
    const [hadDifficulty, setHadDifficulty] = useState(null); // true | false | null
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!user) return;
        // Marketplace survey is for CUSTOMER signups; provider Google signups
        // also carry signupSurveyPending but their survey belongs to the business app.
        if (user.role !== 'customer') return;
        let dismissed = false;
        try { dismissed = localStorage.getItem(DISMISSED_KEY) === 'true'; } catch { /* storage disabled */ }
        if (dismissed) return;
        if (user.signupSurvey) return; // already answered — { hadDifficulty, comment, submittedAt }
        // Only prompt genuine new signups. signupSurveyPending is set true only at
        // registration, so pre-existing accounts (field absent/false) never see it.
        if (!user.signupSurveyPending) return;
        setOpen(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    // Lock background scroll + close on Escape while the modal is open, matching ReviewModal.
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
        window.addEventListener('keydown', onKey);
        return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const markDone = () => {
        try { localStorage.setItem(DISMISSED_KEY, 'true'); } catch { /* storage disabled/full — non-fatal */ }
        setOpen(false);
    };

    const dismiss = () => {
        // Clear the pending flag server-side so it never reappears on another device;
        // no survey row is stored for a dismissal.
        API.post('/auth/signup-survey', { dismissed: true }).catch(() => {});
        setUser(prev => prev ? { ...prev, signupSurveyPending: false } : prev);
        markDone();
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (hadDifficulty === null) { setError('Please choose Yes or No'); return; }
        setSubmitting(true);
        setError('');
        try {
            const trimmedComment = comment.trim();
            await API.post('/auth/signup-survey', {
                hadDifficulty,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
            });
            // Reflect it locally right away so nothing re-triggers this session.
            setUser(prev => prev ? { ...prev, signupSurveyPending: false, signupSurvey: { hadDifficulty, comment: trimmedComment || undefined, submittedAt: new Date().toISOString() } } : prev);
            markDone();
        } catch {
            setError('Could not submit — please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return (
        <div
            onClick={dismiss}
            className="sheet-overlay"
            style={{
                position: 'fixed', inset: 0, zIndex: 1400,
                background: 'rgba(4,5,5,0.55)', backdropFilter: 'blur(3px)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                padding: '0', animation: 'fadeIn 0.18s ease',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="signup-survey-title"
                className="sheet-panel"
                style={{
                    background: 'var(--card-bg)', width: '100%', maxWidth: '440px',
                    borderRadius: '20px 20px 0 0', boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
                    padding: '1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom))',
                    animation: 'slideUp 0.24s var(--ease-out, cubic-bezier(0.16,1,0.3,1))',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <h2 id="signup-survey-title" style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '600', color: 'var(--charcoal)', margin: 0 }}>
                        Quick question
                    </h2>
                    <button onClick={dismiss} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.6rem', lineHeight: 1, padding: '0 0.25rem' }}>×</button>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 1.25rem' }}>
                    Did you experience any difficulties signing up?
                </p>

                {error && (
                    <div role="alert" style={{ background: 'var(--danger-bg,#fee2e2)', border: '1px solid #fca5a5', color: 'var(--danger-fg,#991b1b)', padding: '0.7rem 0.9rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {[{ label: 'Yes', value: true }, { label: 'No', value: false }].map(opt => {
                            const active = hadDifficulty === opt.value;
                            return (
                                <button
                                    key={opt.label}
                                    type="button"
                                    onClick={() => setHadDifficulty(opt.value)}
                                    aria-pressed={active}
                                    style={{
                                        flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-sm)',
                                        border: `1.5px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                                        background: active ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
                                        color: active ? 'var(--gold-dark)' : 'var(--charcoal)',
                                        fontFamily: 'var(--font-body)', fontSize: '0.9rem', fontWeight: '600',
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    }}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                            Anything you'd like to add? (optional)
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            rows="3"
                            maxLength={500}
                            placeholder="Tell us what tripped you up…"
                            className="input"
                            style={{ resize: 'vertical', fontFamily: 'var(--font-body)', width: '100%' }}
                        />
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'right', margin: '0.25rem 0 0' }}>{comment.length}/500</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
                        <button type="button" onClick={dismiss} className="btn-outline" style={{ flex: 1 }}>Not now</button>
                        <button type="submit" disabled={submitting} className="btn-primary" style={{ flex: 1, opacity: submitting ? 0.7 : 1 }}>
                            {submitting ? 'Submitting…' : 'Submit'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SignupSurveyModal;
