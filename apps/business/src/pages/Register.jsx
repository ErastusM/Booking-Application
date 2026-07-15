import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryParams } from '../routing';
import { authService } from '../services';
import MAIN_CATEGORIES from '../constants/mainCategories';
import { API_BASE } from '../services/api';
import { MailCheck, Check } from 'lucide-react';

// Legal pages are hosted once on the customer marketplace site; link out to the
// canonical copies (opened in a new tab so the signup form isn't lost).
const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'https://www.bookplus.pro';

/**
 * "List your business" — the business side's own signup (Fresha model: the
 * two apps are separate products). Always registers a PROVIDER account; an
 * email that already has a customer account can sign up here too — auth is
 * scoped per account type.
 */
const Register = () => {
    // The login page's "create a business account" CTA carries the email across.
    const searchParams = useQueryParams();
    const [submitted, setSubmitted] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        email: searchParams.get('email') || '',
        phone: '',
        password: '',
        providerCategory: '',
    });
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

    const passwordChecks = [
        { label: 'At least 8 characters', valid: formData.password.length >= 8 },
        { label: 'One uppercase letter', valid: /[A-Z]/.test(formData.password) },
        { label: 'One number', valid: /\d/.test(formData.password) },
        { label: 'One special character', valid: /[^A-Za-z0-9]/.test(formData.password) },
    ];
    const passwordValid = passwordChecks.every(c => c.valid);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.providerCategory) {
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
                role: 'provider',
                providerCategory: formData.providerCategory === 'Other'
                    ? customCategory.trim()
                    : formData.providerCategory,
            });
            setSubmitted(true); // verification email sent — gate on it like the customer app
        } catch (err) {
            setError(err.response?.data?.message || 'Registration failed');
        } finally {
            setLoading(false);
        }
    };

    const fields = [
        { name: 'name', label: 'Your Name', type: 'text', placeholder: 'John Smith', autoComplete: 'name', autoCapitalize: 'words', autoCorrect: 'off' },
        { name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', autoComplete: 'email', autoCapitalize: 'none', autoCorrect: 'off' },
        { name: 'phone', label: 'Phone Number', type: 'tel', placeholder: '+264 81 234 5678', autoComplete: 'tel', autoCapitalize: 'none', autoCorrect: 'off' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••', autoComplete: 'new-password', autoCapitalize: 'none', autoCorrect: 'off' },
    ];

    return (
        <div style={{
            minHeight: '100dvh',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            background: 'var(--off-white)',
        }}>
            {/* Left panel — mirrors the Login page */}
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
                        List your<br />
                        <span style={{ color: 'var(--gold)', fontStyle: 'italic' }}>business.</span>
                    </h2>
                    <p style={{
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: '1rem',
                        lineHeight: 1.7,
                        fontWeight: '300',
                        maxWidth: '340px',
                    }}>
                        Take bookings, manage your calendar and team, and get discovered by new clients — all in one place.
                    </p>
                    <div className="gold-divider" style={{ marginTop: '2rem' }} />
                </div>
            </div>

            {/* Right panel — form / check-your-email */}
            <div className="auth-right" style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4rem 3rem',
            }}>
                {submitted ? (
                    <div style={{ width: '100%', maxWidth: '440px', textAlign: 'center' }} className="fade-up">
                        <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                            <MailCheck size={56} strokeWidth={1.5} style={{ color: 'var(--gold)' }} />
                        </div>
                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.75rem' }}>
                            Check your email!
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '2rem' }}>
                            We sent a verification link to <strong style={{ color: 'var(--charcoal)' }}>{formData.email}</strong>. Click the link in the email to activate your business account.
                        </p>
                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', marginBottom: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                                Didn't get the email? Check your spam folder or{' '}
                                <button onClick={handleResend} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: '600', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.85rem', padding: 0 }}>
                                    resend the link
                                </button>
                            </p>
                            {resendMsg && <p style={{ fontSize: '0.8rem', color: 'var(--gold-dark)', marginTop: '0.5rem' }}>{resendMsg}</p>}
                        </div>
                        <Link to="/login" style={{ color: 'var(--text-muted)', fontSize: '0.875rem', textDecoration: 'none' }}>
                            Already verified? <span style={{ color: 'var(--gold)', fontWeight: '600' }}>Sign in →</span>
                        </Link>
                    </div>
                ) : (
                    <div style={{ width: '100%', maxWidth: '440px' }} className="fade-up">
                        <h1 style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '2rem',
                            fontWeight: '700',
                            color: 'var(--charcoal)',
                            marginBottom: '0.5rem',
                        }}>
                            Create your business account
                        </h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
                            Already listed?{' '}
                            <Link to="/login" style={{ color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none' }}>
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
                                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: check.valid ? 'var(--success)' : 'var(--text-muted)', transition: 'color 0.2s' }}>
                                                    {check.valid ? <Check size={14} strokeWidth={3} style={{ color: '#10b981', flexShrink: 0 }} /> : <span style={{ display: 'inline-block', width: '14px', textAlign: 'center' }}>○</span>}
                                                    {check.label}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}

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

                            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5, cursor: 'pointer', marginTop: '0.25rem' }}>
                                <input
                                    type="checkbox"
                                    checked={consented}
                                    onChange={e => setConsented(e.target.checked)}
                                    aria-label="Agree to Terms of Service and Privacy Policy"
                                    style={{ marginTop: '0.15rem', width: '16px', height: '16px', flexShrink: 0, accentColor: 'var(--gold)', cursor: 'pointer' }}
                                />
                                <span>
                                    I have read and agree to the{' '}
                                    <a href={`${CUSTOMER_URL}/terms`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>Terms of Service</a>{' '}and{' '}
                                    <a href={`${CUSTOMER_URL}/privacy-policy`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>Privacy Policy</a>, and consent to the processing of my personal information as described.
                                </span>
                            </label>

                            <button
                                type="submit"
                                disabled={loading || !passwordValid || !consented}
                                className="btn-primary"
                                style={{ width: '100%', marginTop: '0.5rem', padding: '0.875rem' }}
                            >
                                {loading ? 'Creating account...' : 'List my business →'}
                            </button>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', margin: '0.5rem 0' }}>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>or continue with</span>
                                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                            </div>

                            <a
                                href={`${API_BASE}/api/auth/google?role=provider`}
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
                                    fontFamily: 'var(--font-body)',
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
            </div>
        </div>
    );
};

export default Register;
