import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MIN_SIGNUP_AGE } from '@bookplus/api-client';
import { authService } from '../services';

// "Finish signing up" — the step between Google and a NEW Bookplus account.
// Google proves who the person is; this is where they see and accept the Terms
// and Privacy Policy and confirm their age. The account is only created when
// they tap "Create my account" (POST /api/auth/google/complete); walking away
// leaves nothing behind.
const FinishGoogleSignup = ({ code, onDone, onCancel, showMarketing = false }) => {
    const [who, setWho] = useState(null);
    const [terms, setTerms] = useState(false);
    const [age, setAge] = useState(false);
    const [marketing, setMarketing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        authService.getGoogleSignup(code)
            .then((r) => setWho(r.data.data))
            .catch((e) => setError(e.response?.data?.message || 'This sign-up link has expired. Please continue with Google again.'));
    }, [code]);

    const submit = async (e) => {
        e.preventDefault();
        if (!terms || !age) { setError(`Please accept the Terms and Privacy Policy and confirm you are ${MIN_SIGNUP_AGE} or older.`); return; }
        setBusy(true); setError('');
        try {
            const r = await authService.completeGoogleSignup({ code, termsAccepted: true, ageConfirmed: true, marketingOptIn: showMarketing && marketing });
            onDone(r.data.data);
        } catch (err) {
            setError(err.response?.data?.message || 'Could not create your account. Please try again.');
            setBusy(false);
        }
    };

    const box = { display: 'flex', alignItems: 'flex-start', gap: '0.55rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', fontFamily: 'var(--font-body)' };
    const tick = { marginTop: '0.15rem', width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--gold)', cursor: 'pointer' };
    const link = { color: 'var(--gold-dark)', textDecoration: 'underline' };

    return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)', padding: '1.5rem' }}>
            <form onSubmit={submit} data-testid="finish-signup" style={{ width: '100%', maxWidth: '420px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--charcoal)', margin: 0 }}>Finish signing up</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0, fontFamily: 'var(--font-body)' }}>
                    {who ? <>You’re creating a Bookplus {who.role === 'provider' ? 'business ' : ''}account for <strong style={{ color: 'var(--charcoal)' }}>{who.email}</strong> with Google.</> : 'One more step before your account is created.'}
                </p>
                <label htmlFor="finish-terms" style={box}>
                    <input id="finish-terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={tick} data-testid="finish-terms" />
                    <span>I have read and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer" style={link}>Terms of Service</Link> and the <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" style={link}>Privacy Policy</Link>.</span>
                </label>
                <label htmlFor="finish-age" style={box}>
                    <input id="finish-age" type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} style={tick} data-testid="finish-age" />
                    <span>I am {MIN_SIGNUP_AGE} or older.</span>
                </label>
                {showMarketing && (
                    <label htmlFor="finish-marketing" style={box}>
                        <input id="finish-marketing" type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} style={tick} />
                        <span>Email me rebooking reminders and offers from Bookplus (optional). Unsubscribe any time with one click.</span>
                    </label>
                )}
                {error && <p role="alert" style={{ color: 'var(--danger-fg)', fontSize: '0.85rem', margin: 0 }}>{error}</p>}
                <button type="submit" className="btn-primary" disabled={busy || !who || !terms || !age} data-testid="finish-create" style={{ width: '100%', padding: '0.85rem' }}>
                    {busy ? 'Creating your account…' : 'Create my account'}
                </button>
                <button type="button" className="btn-outline" onClick={onCancel} disabled={busy} style={{ width: '100%', padding: '0.75rem' }}>
                    Cancel — don’t create an account
                </button>
            </form>
        </div>
    );
};

export default FinishGoogleSignup;
