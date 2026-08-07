import React, { useState } from 'react';
import API from '../services/api';

// Keyed distinctly for the business app, mirroring the splash-flag pattern —
// backstops the `user.signupSurvey` check so the prompt never re-shows after
// the user submits or dismisses it, even before the profile refetch lands.
const STORAGE_KEY = 'bp_business_signup_survey_done';

// Gate: show only for a logged-in user who hasn't answered yet (null/undefined
// `signupSurvey` on the /auth/profile payload counts as "not answered") AND
// hasn't already submitted/dismissed locally.
export const shouldShowSignupSurvey = (user) => {
    if (!user || user.signupSurvey) return false;
    try {
        return localStorage.getItem(STORAGE_KEY) !== 'true';
    } catch {
        return true;
    }
};

const markDone = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* storage disabled — non-fatal */ }
};

// One-time "did signup go smoothly?" prompt. Self-contained — owns its own
// submit/dismiss state and reports back via onDone so the caller can drop it
// from the tree (no need to track open/closed itself).
const SignupSurveyModal = ({ onDone }) => {
    const [hadDifficulty, setHadDifficulty] = useState(null); // null (unanswered) | true | false
    const [comment, setComment] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const finish = () => { markDone(); onDone(); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (hadDifficulty === null) { setError('Please choose Yes or No'); return; }
        setSubmitting(true);
        setError('');
        try {
            await API.post('/auth/signup-survey', {
                hadDifficulty,
                ...(comment.trim() ? { comment: comment.trim() } : {}),
            });
            finish();
        } catch {
            setError('Could not submit — please try again.');
            setSubmitting(false);
        }
    };

    return (
        <div
            className="sheet-overlay"
            style={{
                position: 'fixed', inset: 0, zIndex: 1400,
                background: 'rgba(4,5,5,0.55)', backdropFilter: 'blur(3px)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                animation: 'fadeIn 0.18s ease',
            }}
        >
            <div
                className="sheet-panel"
                style={{
                    background: 'var(--card-bg)', width: '100%', maxWidth: '440px',
                    borderRadius: '20px 20px 0 0', boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
                    padding: '1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom))',
                    animation: 'slideUp 0.24s var(--ease-out, cubic-bezier(0.16,1,0.3,1))',
                }}
            >
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>
                    Quick question
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.25rem', lineHeight: 1.6 }}>
                    Did you experience any difficulties signing up?
                </p>

                {error && (
                    <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.65rem 0.9rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.82rem' }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                        {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(opt => (
                            <button
                                key={String(opt.v)}
                                type="button"
                                onClick={() => setHadDifficulty(opt.v)}
                                style={{
                                    flex: 1, padding: '0.75rem', borderRadius: 'var(--radius-sm)',
                                    border: `1.5px solid ${hadDifficulty === opt.v ? 'var(--gold)' : 'var(--border)'}`,
                                    background: hadDifficulty === opt.v ? 'rgba(240,62,22,0.1)' : 'var(--card-bg)',
                                    color: hadDifficulty === opt.v ? 'var(--gold-dark)' : 'var(--text-secondary)',
                                    fontWeight: '700', fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'var(--font-body)',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {opt.l}
                            </button>
                        ))}
                    </div>

                    {hadDifficulty !== null && (
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="Optional — tell us what happened…"
                            rows={3}
                            maxLength={500}
                            className="input"
                            style={{ resize: 'vertical', marginBottom: '1.25rem' }}
                        />
                    )}

                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <button type="button" onClick={finish} className="btn-outline" style={{ flex: 1, padding: '0.75rem' }}>
                            Skip
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || hadDifficulty === null}
                            className="btn-primary"
                            style={{ flex: 1, padding: '0.75rem', opacity: (submitting || hadDifficulty === null) ? 0.6 : 1 }}
                        >
                            {submitting ? 'Sending…' : 'Submit'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SignupSurveyModal;
