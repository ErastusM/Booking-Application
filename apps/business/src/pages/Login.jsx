import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { API_BASE } from '../services/api';

const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'http://localhost:3002';

const Login = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // Sent here by the website's destination chooser when the business account
    // keeps its own password: carry the email over so they only retype the one
    // thing we actually need.
    const [formData, setFormData] = useState({ email: searchParams.get('email') || '', password: '' });
    const fromWebsite = searchParams.get('from') === 'website';
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Set when the email has no business account (Fresha model: this side only
    // signs in business accounts) — the error then carries a signup CTA.
    const [showSignupCta, setShowSignupCta] = useState(false);
    // NO destination chooser on this door. Opening business.bookplus.pro is
    // itself the choice — asking again would be asking twice. The chooser lives
    // on the website (www), which is the only entry point that cannot know which
    // side the visitor means.

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const homeForRole = (role) =>
        (role === 'admin' ? '/bkplus-command' : role === 'staff' ? '/my-schedule' : '/dashboard');

    // Authenticate the CUSTOMER account with the same credentials. The login
    // response sets the SSO refresh cookie (withCredentials), so a plain
    // navigation lands them on the customer site already signed in. Their
    // customer tokens are never stored on this origin.
    const handOffToCustomer = async () => {
        await authService.login({ ...formData, accountType: 'customer' });
        window.location.assign(CUSTOMER_URL);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setShowSignupCta(false);
        try {
            // The api-client stamps accountType:'business' on this call, so this
            // authenticates the business account (provider/staff/admin) if one exists.
            const response = await authService.login(formData);
            const session = response.data.data;
            // Straight in. They came to the business door, so a customer account
            // on the same email is not a question to put to them here.
            login(session);
            navigate(homeForRole(session?.user?.role));
        } catch (err) {
            // A wrong-side 403 carries the other side's accountType; an admin
            // suspension is ALSO a 403 and carries none. Branching on the bare
            // status treated a suspended business account as "wrong site" and
            // tried to sign them into the customer site instead of telling them
            // they are suspended — so read the discriminator the server sends.
            const wrongSide = err.response?.data?.accountType === 'customer';
            if (wrongSide) {
                try { await handOffToCustomer(); return; } catch { /* fall through */ }
            }
            setError(err.response?.data?.message || 'Login failed');
            // Wrong-side 403 that couldn't hand off: this email isn't listed as a
            // business yet — offer the signup path. A plain wrong password (401)
            // or a suspension is NOT a reason to suggest a duplicate business.
            setShowSignupCta(wrongSide);
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
                        <Link to="/register" style={{ color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none' }}>
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
                            {showSignupCta && (
                                <div style={{ marginTop: '0.6rem', paddingTop: '0.6rem', borderTop: '1px solid #fca5a5' }}>
                                    New to Bookplus?{' '}
                                    <Link
                                        to={`/register${formData.email ? `?email=${encodeURIComponent(formData.email)}` : ''}`}
                                        style={{ color: '#991b1b', fontWeight: '600', textDecoration: 'underline' }}
                                    >
                                        List your business →
                                    </Link>
                                </div>
                            )}
                        </div>
                    )}

                    {fromWebsite && !error && (
                        <div data-testid="from-website-note" style={{
                            background: 'rgba(240,62,22,0.08)', border: '1px solid var(--gold)',
                            color: 'var(--gold-dark)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)',
                            marginBottom: '1.5rem', fontSize: '0.85rem', lineHeight: 1.5,
                        }}>
                            Your business account has its own sign-in — sign in here to open the dashboard.
                        </div>
                    )}

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
                                <Link to="/forgot-password" style={{ color: 'var(--gold-dark)', fontWeight: '500', fontSize: '0.82rem', textDecoration: 'none' }}>
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
                            href={`${API_BASE}/api/auth/google?role=provider`}
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
                </div>
            </div>
        </div >
    );
};

export default Login;