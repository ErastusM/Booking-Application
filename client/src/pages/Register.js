import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const Register = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
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
            const response = await authService.register(formData);
            login(response.data.data);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const fields = [
        { name: 'name', label: 'Full Name', type: 'text', placeholder: 'John Smith' },
        { name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com' },
        { name: 'phone', label: 'Phone Number', type: 'tel', placeholder: '+1 234 567 8900' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
    ];

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
                    backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(201,168,76,0.12) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <Link to="/" style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: '1.8rem',
                        fontWeight: '700',
                        color: 'var(--gold)',
                        textDecoration: 'none',
                        display: 'block',
                        marginBottom: '4rem',
                    }}>
                        Barber<span style={{ color: 'white' }}>Shop</span>
                    </Link>
                    <h2 style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: 'clamp(2rem, 3vw, 2.8rem)',
                        fontWeight: '700',
                        color: 'white',
                        lineHeight: 1.2,
                        marginBottom: '1.5rem',
                    }}>
                        Join the{' '}
                        <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>craft.</span>
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: '300',
                        maxWidth: '340px',
                    }}>
                        Create your account and start booking appointments with our expert barbers in seconds.
                    </p>

                    <div style={{ marginTop: '3rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {['No waiting rooms', 'Instant confirmation', 'Easy rescheduling', 'Loyalty rewards'].map((perk, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                <div style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: 'rgba(201,168,76,0.2)',
                                    border: '1px solid rgba(201,168,76,0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'var(--gold)',
                                    fontSize: '0.65rem',
                                    flexShrink: 0,
                                }}>✓</div>
                                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.9rem' }}>{perk}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right panel — form */}
            <div className="auth-right" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4rem 3rem',
                overflowY: 'auto',
            }}>
                <div style={{ width: '100%', maxWidth: '400px' }} className="fade-up">
                    <h1 style={{
                        fontFamily: 'Playfair Display, serif',
                        fontSize: '2rem',
                        fontWeight: '700',
                        color: 'var(--charcoal)',
                        marginBottom: '0.5rem',
                    }}>
                        Create Account
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                        Already have an account?{' '}
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
                        {fields.map(field => (
                            <div key={field.name}>
                                <label style={{
                                    display: 'block',
                                    fontSize: '0.8rem',
                                    fontWeight: '600',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '0.5rem',
                                    letterSpacing: '0.05em',
                                    textTransform: 'uppercase',
                                }}>
                                    {field.label}
                                </label>
                                <input
                                    type={field.type}
                                    name={field.name}
                                    value={formData[field.name]}
                                    onChange={handleChange}
                                    required
                                    placeholder={field.placeholder}
                                    className="input"
                                />
                            </div>
                        ))}

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary"
                            style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                        >
                            {loading ? 'Creating account...' : 'Create Account →'}
                        </button>

                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                            By signing up you agree to our Terms of Service and Privacy Policy.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Register;