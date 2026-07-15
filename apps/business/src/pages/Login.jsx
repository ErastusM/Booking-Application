import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useNav } from '../routing';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { API_BASE } from '../services/api';

const Login = () => {
    const { login } = useAuthContext();
    const navigate = useNav();
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    // Set when the email has no business account (Fresha model: this side only
    // signs in business accounts) — the error then carries a signup CTA.
    const [showSignupCta, setShowSignupCta] = useState(false);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setShowSignupCta(false);
        try {
            // The api-client stamps accountType:'business' on this call, so only
            // business accounts (provider/staff/admin) authenticate here — a
            // customer-only email gets a clear error instead of a wrong-side login.
            const response = await authService.login(formData);
            login(response.data.data);
            const role = response.data.data?.user?.role;
            if (role === 'admin') navigate('/bkplus-command');
            else if (role === 'staff') navigate('/my-schedule');
            else navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed');
            // 403 = the email only has a customer account; 401 = no match at
            // all. Either way this email isn't listed as a business yet, so
            // offer the signup path instead of a dead end.
            const status = err.response?.status;
            setShowSignupCta(status === 403 || status === 401);
        } finally {
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
                        fontWeight: '700',
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
                        fontWeight: '700',
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
                        fontWeight: '700',
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
                                        style={{ color: '#991b1b', fontWeight: '700', textDecoration: 'underline' }}
                                    >
                                        List your business →
                                    </Link>
                                </div>
                            )}
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