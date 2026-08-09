import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services';

const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            await authService.forgotPassword(email);
            setSubmitted(true);
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong. Please try again.');
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
                        fontFamily: 'var(--font-body)',
                        fontSize: 'clamp(2rem, 3vw, 2.8rem)',
                        fontWeight: '600',
                        color: 'white',
                        lineHeight: 1.2,
                        marginBottom: '1.5rem',
                    }}>
                        Forgot your<br />
                        <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>password?</span>
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: '300',
                        maxWidth: '340px',
                    }}>
                        No worries. Enter your email address and we'll send you a link to reset it.
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
                    {submitted ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1.5rem' }}>📬</div>
                            <h1 style={{
                                fontFamily: 'var(--font-body)',
                                fontSize: '1.8rem',
                                fontWeight: '600',
                                color: 'var(--charcoal)',
                                marginBottom: '1rem',
                            }}>
                                Check your inbox
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                                If an account with <strong>{email}</strong> exists, you'll receive a password reset link shortly. The link expires in 1 hour.
                            </p>
                            <Link to="/login" style={{
                                color: 'var(--gold)',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                textDecoration: 'none',
                            }}>
                                ← Back to Sign In
                            </Link>
                        </div>
                    ) : (
                        <>
                            <h1 style={{
                                fontFamily: 'var(--font-body)',
                                fontSize: '2rem',
                                fontWeight: '600',
                                color: 'var(--charcoal)',
                                marginBottom: '0.5rem',
                            }}>
                                Reset Password
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                                Remember it?{' '}
                                <Link to="/login" style={{ color: 'var(--gold)', fontWeight: '600', textDecoration: 'none' }}>
                                    Sign in here
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
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        required
                                        placeholder="you@example.com"
                                        className="input"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="btn-primary"
                                    style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                                >
                                    {loading ? 'Sending...' : 'Send Reset Link →'}
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
