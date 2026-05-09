import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const roles = [
    {
        value: 'customer',
        icon: '✂️',
        title: 'Book Services',
        description: 'I want to browse and book grooming appointments with professional barbers.',
    },
    {
        value: 'provider',
        icon: '💈',
        title: 'Offer Services',
        description: 'I am a barber or grooming professional and want to receive bookings.',
    },
];

const Register = () => {
    const { login } = useAuthContext();
    const navigate = useNavigate();
    const [step, setStep] = useState(1);
    const [selectedRole, setSelectedRole] = useState('');
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        setStep(2);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            const response = await authService.register({ ...formData, role: selectedRole });
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
        <div style={{ minHeight: '100vh', background: 'var(--off-white)', display: 'flex', flexDirection: 'column' }}>

            {/* Navbar area */}
            <div style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link to="/" style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold)', textDecoration: 'none' }}>
                    Barber<span style={{ color: 'var(--charcoal)' }}>Shop</span>
                </Link>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--gold)', fontWeight: '600', textDecoration: 'none' }}>Sign in</Link>
                </p>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                {[1, 2].map(s => (
                    <div key={s} style={{
                        width: s === step ? '2rem' : '0.5rem',
                        height: '0.5rem',
                        borderRadius: '99px',
                        background: s <= step ? 'var(--gold)' : 'var(--border)',
                        transition: 'all 0.3s ease',
                    }} />
                ))}
            </div>

            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>

                {/* Step 1 — Role selection */}
                {step === 1 && (
                    <div style={{ width: '100%', maxWidth: '560px' }} className="fade-up">
                        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                What brings you here?
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                                Choose how you want to use BarberShop
                            </p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            {roles.map(role => (
                                <button
                                    key={role.value}
                                    onClick={() => handleRoleSelect(role.value)}
                                    style={{
                                        padding: '2rem 1.5rem',
                                        background: 'white',
                                        border: '2px solid var(--border)',
                                        borderRadius: 'var(--radius)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'all 0.2s ease',
                                        boxShadow: 'var(--shadow-sm)',
                                        fontFamily: 'DM Sans, sans-serif',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.borderColor = 'var(--gold)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.borderColor = 'var(--border)';
                                        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }}
                                >
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{role.icon}</div>
                                    <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                                        {role.title}
                                    </h3>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
                                        {role.description}
                                    </p>
                                    <div style={{ marginTop: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--gold-dark)', fontSize: '0.85rem', fontWeight: '600' }}>
                                        Get started →
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 2 — Account details */}
                {step === 2 && (
                    <div style={{ width: '100%', maxWidth: '440px' }} className="fade-up">
                        <button
                            onClick={() => setStep(1)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.875rem', fontFamily: 'DM Sans, sans-serif', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: 0 }}
                        >
                            ← Back
                        </button>

                        {/* Selected role badge */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '99px', padding: '0.35rem 1rem', marginBottom: '1.5rem' }}>
                            <span style={{ fontSize: '1rem' }}>{roles.find(r => r.value === selectedRole)?.icon}</span>
                            <span style={{ color: 'var(--gold-dark)', fontSize: '0.8rem', fontWeight: '600' }}>
                                {roles.find(r => r.value === selectedRole)?.title}
                            </span>
                        </div>

                        <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                            Create your account
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                            Fill in your details to get started
                        </p>

                        {error && (
                            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {fields.map(field => (
                                <div key={field.name}>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
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
                            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}>
                                {loading ? 'Creating account...' : 'Create Account →'}
                            </button>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                                By signing up you agree to our Terms of Service and Privacy Policy.
                            </p>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Register;