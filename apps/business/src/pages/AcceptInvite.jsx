import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

/**
 * Accept-invite landing (Fresha-style). An invited staff member lands here from
 * the emailed link, sees who invited them, sets a password, and is signed
 * STRAIGHT IN to their own calendar — no bounce to the login screen.
 *
 * Falls back gracefully when the token is missing/expired, and points a
 * returning member (re-invited) at the same set-a-password step.
 */
const AcceptInvite = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { login } = useAuthContext();
    const token = searchParams.get('token');

    const [preview, setPreview] = useState(null);   // { name, email, businessName, returning }
    const [checking, setChecking] = useState(true);
    const [invalid, setInvalid] = useState(false);

    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

    // Preview the invite so the page can greet the person by name. A bad/expired
    // token resolves to the invalid state rather than a blank form.
    useEffect(() => {
        let cancelled = false;
        if (!token) { setChecking(false); setInvalid(true); return undefined; }
        (async () => {
            try {
                const res = await authService.getStaffInvite(token);
                if (cancelled) return;
                setPreview(res.data?.data || null);
            } catch {
                if (!cancelled) setInvalid(true);
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password !== confirm) {
            return setError('Passwords do not match');
        }
        if (!passwordRegex.test(password)) {
            return setError('Password must be at least 8 characters and include an uppercase letter, a number and a special character');
        }

        setLoading(true);
        try {
            const res = await authService.acceptStaffInvite(token, password);
            const session = res.data?.data;
            // Store the session and go straight to their calendar — signed in.
            login(session);
            navigate('/my-schedule');
        } catch (err) {
            setError(err.response?.data?.message || 'Could not accept the invite. The link may have expired.');
            setLoading(false);
        }
    };

    const heading = preview?.returning ? 'Welcome back' : 'Accept your invite';
    const businessName = preview?.businessName || 'your team';

    // Invalid / expired token — a clear dead-end with the way back.
    if (!checking && (invalid || !preview)) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--off-white)' }}>
                <div style={{ textAlign: 'center', maxWidth: '400px', padding: '2rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                    <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--charcoal)', marginBottom: '1rem' }}>Invite link expired</h2>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                        This invite link is invalid or has expired. Ask whoever added you to your team to resend it, then open the newest email.
                    </p>
                    <Link to="/login" className="btn-primary" style={{ textDecoration: 'none', padding: '0.75rem 1.5rem', display: 'inline-block' }}>
                        Go to sign in
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--off-white)',
        }}>
            {/* Left decorative panel */}
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
                        fontWeight: '600',
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
                        fontWeight: '600',
                        color: 'white',
                        lineHeight: 1.2,
                        marginBottom: '1.5rem',
                    }}>
                        You’re joining<br />
                        <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>{businessName}.</span>
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: '300',
                        maxWidth: '340px',
                    }}>
                        Set a password and you’ll go straight to your own schedule — your bookings, your clients, your hours. All yours.
                    </p>
                    <div className="gold-divider" style={{ marginTop: '2rem' }} />
                </div>
            </div>

            {/* Right form panel */}
            <div className="auth-right" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4rem 3rem',
            }}>
                <div style={{ width: '100%', maxWidth: '400px' }} className="fade-up">
                    <h1 style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '2rem',
                        fontWeight: '600',
                        color: 'var(--charcoal)',
                        marginBottom: '0.5rem',
                    }}>
                        {checking ? 'Loading…' : heading}
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                        {checking
                            ? 'Checking your invite…'
                            : <>
                                {preview?.name ? <><strong>{preview.name}</strong>, y</> : 'Y'}ou were invited to join <strong>{businessName}</strong>
                                {preview?.email ? <> as {preview.email}</> : null}. Set a password to finish and sign in.
                            </>}
                    </p>

                    {error && (
                        <div style={{
                            background: '#fee2e2',
                            border: '1px solid #fca5a5',
                            color: '#991b1b',
                            padding: '0.75rem 1rem',
                            borderRadius: 'var(--radius-sm)',
                            marginBottom: '1.5rem',
                            fontSize: '0.85rem',
                        }}>
                            {error}
                        </div>
                    )}

                    {!checking && (
                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div>
                                <label style={{
                                    display: 'block',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '0.5rem',
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                }}>
                                    Create Password
                                </label>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                    className="input"
                                    data-testid="accept-password"
                                />
                            </div>

                            <div>
                                <label style={{
                                    display: 'block',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '0.5rem',
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                }}>
                                    Confirm Password
                                </label>
                                <input
                                    type="password"
                                    value={confirm}
                                    onChange={e => setConfirm(e.target.value)}
                                    required
                                    placeholder="••••••••"
                                    className="input"
                                    data-testid="accept-confirm"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="btn-primary"
                                style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                                data-testid="accept-submit"
                            >
                                {loading ? 'Setting up…' : 'Accept & go to my schedule →'}
                            </button>

                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', marginTop: '0.25rem' }}>
                                Already set up? <Link to="/login" style={{ color: 'var(--gold-dark)', fontWeight: 600, textDecoration: 'none' }}>Sign in</Link>
                            </p>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AcceptInvite;
