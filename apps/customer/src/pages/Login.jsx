import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { API_BASE } from '../services/api';

// Where to land after signing in. `?next=` lets a flow that had to interrupt the
// visitor (e.g. joining a waiting list mid-booking) send them back where they
// were instead of dropping them on Home. Only same-origin RELATIVE paths are
// honoured — an absolute or protocol-relative URL would turn our own login into
// an open redirect.
const safeNext = (raw) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null);

// ?error= codes other flows redirect here with (the axios refresh interceptor on a
// lapsed session, the Google OAuth callback on failure) — map the known ones to a
// friendly message instead of silently dropping them.
const ERROR_MESSAGES = {
    session_expired: 'Your session has expired. Please sign in again.',
    google_failed: 'Google sign-in didn’t go through. Please try again or sign in with your email and password.',
};

const BUSINESS_URL = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';

const Login = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const next = safeNext(searchParams.get('next'));
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(() => ERROR_MESSAGES[searchParams.get('error')] || '');
    // One email can hold BOTH a customer and a business account. When it does,
    // we hold the authenticated customer session here (uncommitted) and ask
    // where they want to go instead of picking for them. This is the ambiguous
    // door — www is where someone arrives without having declared which side
    // they are — so the choice belongs here and not on the business app.
    const [pendingSession, setPendingSession] = useState(null);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    // Authenticate the BUSINESS account with the same credentials. The login
    // response sets the SSO refresh cookie (withCredentials), so a plain
    // navigation lands them on the business app already signed in. Their
    // business tokens are never stored on this origin.
    const handOffToBusiness = async () => {
        await authService.login({ ...formData, accountType: 'business' });
        window.location.assign(BUSINESS_URL);
    };

    // The business account exists but has its own sign-in (a different password,
    // or Google — the two sides drift apart routinely, each signup and reset
    // being per-side). We never mint a session for an account nobody proved, so
    // send them to the business door with the email filled in and say why.
    const sendToBusinessLogin = (email) => {
        const q = new URLSearchParams({ email: email || '', from: 'website' });
        window.location.assign(`${BUSINESS_URL}/login?${q}`);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            // The api-client stamps accountType:'customer' here, so this
            // authenticates the customer account if one exists.
            const response = await authService.login(formData);
            const session = response.data.data;
            // A business account EXISTS on this email → ask, don't guess. Note
            // this asks about the account's existence, not about whether this
            // password happens to open it too: a business profile with its own
            // password is still a business profile, and silently dropping such
            // people on the customer site is exactly the bug being fixed here.
            // (alsoAccountType is the fallback for a bundle cached before
            // otherSide shipped.)
            const other = session.otherSide
                || (session.alsoAccountType ? { accountType: session.alsoAccountType, sameCredentials: true } : null);
            if (other?.accountType === 'business') {
                setPendingSession({ ...session, otherSide: other });
                setLoading(false);
                return;
            }
            login(session);
            navigate(next || '/');
        } catch (err) {
            // A wrong-side 403 carries the other side's accountType; an admin
            // suspension is ALSO a 403 and carries none. Branching on the bare
            // status treated a suspended customer as "wrong site" and tried to
            // sign them into the business app instead of telling them they are
            // suspended — so read the discriminator the server already sends.
            if (err.response?.data?.accountType === 'business') {
                try { await handOffToBusiness(); return; } catch { /* fall through */ }
            }
            setError(err.response?.data?.message || 'Login failed');
            setLoading(false);
        }
    };

    const chooseCustomer = () => {
        login(pendingSession);
        navigate(next || '/');
    };
    const chooseBusiness = async () => {
        // Same password on both sides → carry them across signed in. Different
        // passwords → hand them to the business sign-in page instead; that
        // account's password was never proven here.
        if (!pendingSession?.otherSide?.sameCredentials) {
            sendToBusinessLogin(formData.email);
            return;
        }
        setLoading(true);
        setError('');
        try { await handOffToBusiness(); }
        catch (err) {
            setError(err.response?.data?.message || 'Could not open the business app. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--off-white)',
        }}>
            {/* Left panel */}
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
                <div style={{
                    position: 'absolute',
                    right: 0,
                    width: '3px',
                    top: '20%',
                    bottom: '20%',
                    background: 'linear-gradient(to bottom, transparent, var(--gold), transparent)',
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
                        Welcome<br />
                        <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>back.</span>
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: '300',
                        maxWidth: '340px',
                    }}>
                        Sign in to manage your bookings, check your appointments, and stay in control.
                    </p>
                    <div className="gold-divider" style={{ marginTop: '2rem' }} />
                </div>
            </div>

            {/* Right panel — form */}
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
                        Sign In
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                        Don't have an account?{' '}
                        <Link to="/register" style={{ color: 'var(--gold)', fontWeight: '600', textDecoration: 'none' }}>
                            Sign up here
                        </Link>
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

                    {pendingSession ? (
                        /* This email holds BOTH accounts — signed in; ask where to go. */
                        <div data-testid="destination-chooser" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <p style={{ color: 'var(--charcoal)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>
                                Where would you like to go?
                            </p>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
                                This email has both a customer and a business account.
                                {!pendingSession.otherSide?.sameCredentials
                                    && ' Your business account has its own sign-in, so you’ll sign in again over there.'}
                            </p>
                            <button type="button" className="btn-primary" onClick={chooseBusiness} disabled={loading}
                                data-testid="choose-business" style={{ width: '100%', padding: '0.875rem' }}>
                                Business Dashboard →
                            </button>
                            <button type="button" className="btn-outline" onClick={chooseCustomer} disabled={loading}
                                data-testid="choose-customer" style={{ width: '100%', padding: '0.875rem' }}>
                                Customer Site
                            </button>
                        </div>
                    ) : (
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
                                Email Address
                            </label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                placeholder="you@example.com"
                                className="input"
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
                                Password
                            </label>
                            <input
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                required
                                placeholder="••••••••"
                                className="input"
                            />
                            <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                                <Link to="/forgot-password" style={{ color: 'var(--gold)', fontWeight: '500', fontSize: '0.82rem', textDecoration: 'none' }}>
                                    Forgot password?
                                </Link>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary"
                            style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                        >
                            {loading ? 'Signing in...' : 'Sign In →'}
                        </button>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>or continue with</span>
                            <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                        </div>

                        <a
                            href={`${API_BASE}/api/auth/google`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.75rem',
                                width: '100%',
                                padding: '0.875rem',
                                border: '1.5px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                background: 'var(--card-bg)',
                                color: 'var(--charcoal)',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                textDecoration: 'none',
                                fontFamily: 'var(--font-body)',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                        >
                            <img
                                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                                width="20"
                                alt="Google"
                            />
                            Continue with Google
                        </a>
                    </form>
                    )}
                </div>
            </div>
        </div >
    );
};

export default Login;