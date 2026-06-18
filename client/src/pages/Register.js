import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services';
import MAIN_CATEGORIES from '../constants/mainCategories';
import { API_BASE } from '../services/api';
import { CalendarCheck, Briefcase, MailCheck, Check } from 'lucide-react';

const roles = [
    {
        value: 'customer',
        Icon: CalendarCheck,
        title: 'Book Services',
        description: 'I want to browse and book services from trusted professionals.',
    },
    {
        value: 'provider',
        Icon: Briefcase,
        title: 'Offer Services',
        description: 'I provide services and want to receive and manage bookings.',
    },
];

const Register = () => {
    const [step, setStep] = useState(1);
    const [selectedRole, setSelectedRole] = useState('');
    const [formData, setFormData] = useState({ name: '', email: '', phone: '', password: '', providerCategory: '' });
    const [customCategory, setCustomCategory] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [passwordFocused, setPasswordFocused] = useState(false);
    const [resendMsg, setResendMsg] = useState('');
    const [consented, setConsented] = useState(false);

    const handleChange = (e) => setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleResend = async () => {
        setResendMsg('Sending…');
        try {
            await authService.resendVerification(formData.email);
            setResendMsg('Sent! Check your inbox (and spam folder).');
        } catch {
            setResendMsg('Could not resend right now — please try again shortly.');
        }
    };

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
        if (formData.providerCategory === 'Other' && !customCategory.trim()) {
            setError('Please describe the service you intend to offer');
            return;
        }
        if (!passwordValid) {
            setError('Please meet all password requirements');
            return;
        }
        if (!consented) {
            setError('Please agree to the Terms of Service and Privacy Policy to continue');
            return;
        }
        setLoading(true);
        setError('');
        try {
            await authService.register({
                ...formData,
                role: selectedRole,
                providerCategory: formData.providerCategory === 'Other'
                    ? customCategory.trim()
                    : formData.providerCategory,
            });
            setStep(3); // New step — check email
        } catch (err) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const fields = [
        { name: 'name', label: 'Full Name', type: 'text', placeholder: 'John Smith', autoComplete: 'name', autoCapitalize: 'words', autoCorrect: 'off' },
        { name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', autoComplete: 'email', autoCapitalize: 'none', autoCorrect: 'off' },
        { name: 'phone', label: 'Phone Number', type: 'tel', placeholder: '+264 81 234 5678', autoComplete: 'tel', autoCapitalize: 'none', autoCorrect: 'off' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••', autoComplete: 'new-password', autoCapitalize: 'none', autoCorrect: 'off' },
    ];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--off-white)', display: 'flex', flexDirection: 'column' }}>

            {/* Navbar */}
            <div style={{ padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <Link to="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', textDecoration: 'none' }}>
                    Book<span style={{ color: 'var(--gold)' }}>plus</span>
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
                            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                What brings you here?
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
                                Choose how you want to use Bookplus
                            </p>
                        </div>

                        <div className="register-role-grid">
                            {roles.map(role => (
                                <button
                                    key={role.value}
                                    onClick={() => handleRoleSelect(role.value)}
                                    style={{
                                        padding: '2rem 1.5rem', background: 'var(--card-bg)',
                                        border: '2px solid var(--border)', borderRadius: 'var(--radius)',
                                        cursor: 'pointer', textAlign: 'left',
                                        transition: 'all 0.2s ease', boxShadow: 'var(--shadow-sm)',
                                        fontFamily: 'Outfit, sans-serif',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                    <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(201,168,76,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}><role.Icon size={26} strokeWidth={2} /></div>
                                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
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
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.875rem', fontFamily: 'Outfit, sans-serif', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: 0 }}
                        >
                            ← Back
                        </button>

                        {/* Selected role badge */}
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: '99px', padding: '0.35rem 1rem', marginBottom: '1.5rem', color: 'var(--gold-dark)' }}>
                            {(() => { const R = roles.find(r => r.value === selectedRole)?.Icon; return R ? <R size={15} strokeWidth={2} /> : null; })()}
                            <span style={{ color: 'var(--gold-dark)', fontSize: '0.8rem', fontWeight: '600' }}>
                                {roles.find(r => r.value === selectedRole)?.title}
                            </span>
                        </div>

                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
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
                                        autoComplete={field.autoComplete}
                                        autoCapitalize={field.autoCapitalize}
                                        autoCorrect={field.autoCorrect}
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
                                                    {check.valid ? <Check size={14} strokeWidth={3} style={{ color: '#10b981', flexShrink: 0 }} /> : <span style={{ display: 'inline-block', width: '14px', textAlign: 'center' }}>○</span>}
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
                                    {formData.providerCategory === 'Other' && (
                                        <input
                                            type="text"
                                            value={customCategory}
                                            onChange={e => setCustomCategory(e.target.value)}
                                            required
                                            placeholder="e.g. Pet Grooming, Tattoo Studio..."
                                            className="input"
                                            style={{ marginTop: '0.75rem' }}
                                        />
                                    )}
                                </div>
                            )}

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', marginTop: '0.25rem' }}>
                                <input
                                    type="checkbox"
                                    checked={consented}
                                    onChange={e => setConsented(e.target.checked)}
                                    aria-label="Agree to Terms of Service and Privacy Policy"
                                    style={{ marginTop: '0.15rem', width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--gold)', cursor: 'pointer' }}
                                />
                                <span>
                                    I have read and agree to the <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)', textDecoration: 'underline' }}>Terms of Service</Link> and <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)', textDecoration: 'underline' }}>Privacy Policy</Link>, and consent to the processing of my personal information as described.
                                </span>
                            </label>
                            <button
                                type="submit"
                                disabled={loading || !passwordValid || !consented}
                                className="btn-primary"
                                style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                            >
                                {loading ? 'Creating account...' : 'Create Account →'}
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>or continue with</span>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                            </div>

                            <a
                                href={`${API_BASE}/api/auth/google?role=${selectedRole || 'customer'}`}
                                onClick={(e) => { if (!consented) { e.preventDefault(); setError('Please agree to the Terms of Service and Privacy Policy to continue'); } }}
                                aria-disabled={!consented}
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
                                    fontFamily: 'Outfit, sans-serif',
                                    opacity: consented ? 1 : 0.55,
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
                                <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}><MailCheck size={56} strokeWidth={1.5} style={{ color: 'var(--gold)' }} /></div>
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                                    Check your email!
                                </h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                                    We sent a verification link to <strong style={{ color: 'var(--charcoal)' }}>{formData.email}</strong>. Click the link in the email to activate your account.
                                </p>
                                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', marginBottom: '1.5rem' }}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                                        Didn't get the email? Check your spam folder or{' '}
                                        <button onClick={handleResend} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: '600', cursor: 'pointer', fontFamily: 'Outfit, sans-serif', fontSize: '0.85rem', padding: 0 }}>
                                            resend the link
                                        </button>
                                    </p>
                                    {resendMsg && <p style={{ fontSize: '0.8rem', color: 'var(--gold-dark)', marginTop: '0.5rem' }}>{resendMsg}</p>}
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