import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services';
import MAIN_CATEGORIES from '../constants/mainCategories';

const roles = [
    {
        value: 'customer',
        icon: '📅',
        title: 'Book Services',
        description: 'I want to browse and book services from trusted professionals.',
    },
    {
        value: 'provider',
        icon: '🧰',
        title: 'Offer Services',
        description: 'I provide services and want to receive and manage bookings.',
    },
];

const Register = () => {
    const [step, setStep] = useState(1);
    const [selectedRole, setSelectedRole] = useState('');
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '', providerCategory: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [passwordFocused, setPasswordFocused] = useState(false);

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        setFormData(prev => ({
            ...prev,
            providerCategory: role === 'provider' ? prev.providerCategory : '',
        }));
        setStep(2);
    };

    const passwordChecks = [
        { label: 'At least 8 characters', valid: formData.password.length >= 8 },
        { label: 'One uppercase letter', valid: /[A-Z]/.test(formData.password) },
        { label: 'One number', valid: /\d/.test(formData.password) },
        { label: 'One special character', valid: /[^A-Za-z0-9]/.test(formData.password) },
    ];
    const passwordValid = passwordChecks.every(c => c.valid);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (selectedRole === 'provider' && !formData.providerCategory) {
            setError('Please select your main service category');
            return;
        }
        if (!passwordValid) {
            setError('Please meet all password requirements');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await authService.register({ ...formData, role: selectedRole });
            setStep(3); // New step — check email
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

            {/* Navbar */}
            <div style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link to="/" style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.5rem', fontWeight: '700', color: 'var(--gold)', textDecoration: 'none' }}>
                    Book<span style={{ color: 'var(--charcoal)' }}>plus</span>
                </Link>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ color: 'var(--gold)', fontWeight: '600', textDecoration: 'none' }}>Sign in</Link>
                </p>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
                {[1, 2, 3].map(s => (
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
                            <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                What brings you here?
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                                Choose how you want to use Bookplus
                            </p>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            {roles.map(role => (
                                <button
                                    key={role.value}
                                    onClick={() => handleRoleSelect(role.value)}
                                    style={{
                                        padding: '2rem 1.5rem', background: 'white',
                                        border: '2px solid var(--border)', borderRadius: 'var(--radius)',
                                        cursor: 'pointer', textAlign: 'left',
                                        transition: 'all 0.2s ease', boxShadow: 'var(--shadow-sm)',
                                        fontFamily: 'Inter, sans-serif',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{role.icon}</div>
                                    <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
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
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.875rem', fontFamily: 'Inter, sans-serif', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: 0 }}
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

                        <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
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
                                        onFocus={() => field.name === 'password' && setPasswordFocused(true)}
                                        onBlur={() => field.name === 'password' && setPasswordFocused(false)}
                                        style={field.name === 'password' && formData.password ? {
                                            borderColor: passwordValid ? '#10b981' : 'var(--border)',
                                            boxShadow: passwordValid ? '0 0 0 3px rgba(16,185,129,0.1)' : 'none',
                                        } : {}}
                                    />
                                    {field.name === 'password' && (passwordFocused || formData.password) && (
                                        <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--warm-gray)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                            {passwordChecks.map((check, i) => (
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: check.valid ? '#065f46' : 'var(--text-muted)', transition: 'color 0.2s' }}>
                                                    <span style={{ fontSize: '0.9rem' }}>{check.valid ? '✅' : '○'}</span>
                                                    {check.label}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}

                            {selectedRole === 'provider' && (
                                <div>
                                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                        Main Category
                                    </label>
                                    <select
                                        name="providerCategory"
                                        value={formData.providerCategory}
                                        onChange={handleChange}
                                        required
                                        className="input"
                                    >
                                        <option value="">Select your primary category</option>
                                        {MAIN_CATEGORIES.map(category => (
                                            <option key={category} value={category}>{category}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || !passwordValid}
                                className="btn-primary"
                                style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                            >
                                {loading ? 'Creating account...' : 'Create Account →'}
                            </button>
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                                By signing up you agree to our Terms of Service and Privacy Policy.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>or continue with</span>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                            </div>

                            <a
                                href="http://localhost:5000/api/auth/google"
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
                )}

                                        {/* Step 3 — Check your email */}
                        {step === 3 && (
                            <div style={{ width: '100%', maxWidth: '440px', textAlign: 'center' }} className="fade-up">
                                <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>📧</div>
                                <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                    Check your email!
                                </h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                                    We sent a verification link to <strong style={{ color: 'var(--charcoal)' }}>{formData.email}</strong>. Click the link in the email to activate your account.
                                </p>
                                <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', marginBottom: '1.5rem' }}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                                        📬 Didn't get the email? Check your spam folder or{' '}
                                        <button onClick={() => setStep(2)} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: '600', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: '0.85rem' }}>
                                            try again
                                        </button>
                                    </p>
                                </div>
                                <Link to="/login" style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textDecoration: 'none' }}>
                                    Already verified? <span style={{ color: 'var(--gold)', fontWeight: '600' }}>Sign in →</span>
                                </Link>
                            </div>
                        )}
            </div>
        </div >
    );
};

export default Register;