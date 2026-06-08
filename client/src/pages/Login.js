import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const Login = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await authService.login(formData);
            login(response.data.data);
            const role = response.data.data?.user?.role;
            if (role === 'provider') navigate('/dashboard');
            else if (role === 'admin') navigate('/bkplus-command');
            else navigate('/');
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--off-white)',
        }}>
            {/* Left panel */}
            <div className="auth-left" style={{
                background: 'var(--charcoal)',
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
                    backgroundImage: 'radial-gradient(ellipse at 30% 70%, rgba(201,168,76,0.12) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    width: '3px',
                    top: '20%',
                    bottom: '20%',
                    background: 'linear-gradient(to bottom, transparent, var(--gold), transparent)',
                }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <Link to="/" style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '1.8rem',
                        fontWeight: '700',
                        color: 'var(--gold)',
                        textDecoration: 'none',
                        display: 'block',
                        marginBottom: '4rem',
                    }}>
                        Book<span style={{ color: 'white' }}>plus</span>
                    </Link>
                    <h2 style={{
                        fontFamily: 'Inter, sans-serif',
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
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '2rem',
                        fontWeight: '700',
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
                            href={`${process.env.REACT_APP_API_URL || 'http://localhost:5000'}/api/auth/google`}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.75rem',
                                width: '100%',
                                padding: '0.875rem',
                                border: '1.5px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                background: 'white',
                                color: 'var(--charcoal)',
                                fontWeight: '600',
                                fontSize: '0.9rem',
                                textDecoration: 'none',
                                fontFamily: 'Inter, sans-serif',
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