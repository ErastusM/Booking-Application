import React, { useEffect, useState } from 'react';
import { useNav } from '../routing';
import { useAuthContext } from '../context/AuthContext';
import { authService } from '../services';
import MAIN_CATEGORIES from '../constants/mainCategories';
import { Briefcase, Check } from 'lucide-react';

const PERKS = [
    'Manage your calendar, bookings and clients in one place',
    'Take online bookings 24/7 with automatic reminders',
    'Keep your customer account — book other businesses too',
];

const BecomeProvider = () => {
    const { user, setUser } = useAuthContext();
    const navigate = useNav();
    const [category, setCategory] = useState('');
    const [customCategory, setCustomCategory] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!user) navigate('/login');
        // Already a business — their dashboard lives in the business app.
        else if (user.role === 'provider') window.location.href = `${import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003'}/dashboard`;
    }, [user, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!category) { setError('Please choose your main service category'); return; }
        if (category === 'Other' && !customCategory.trim()) { setError('Please describe the service you offer'); return; }
        setLoading(true);
        setError('');
        try {
            const res = await authService.becomeProvider({
                providerCategory: category === 'Other' ? customCategory.trim() : category,
            });
            setUser(res.data.data);
            // The business experience lives in the business app — a hard
            // navigation boots it fresh (SSO cookie signs them in there).
            window.location.href = `${import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003'}/dashboard`;
        } catch (err) {
            setError(err.response?.data?.message || 'Could not set up your business');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: '100dvh', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6rem 1rem 3rem' }}>
            <div style={{ width: '100%', maxWidth: '460px' }} className="fade-up">
                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
                    <div style={{ height: '4px', background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))' }} />
                    <div style={{ padding: '2.25rem' }}>
                        <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.1rem' }}>
                            <Briefcase size={26} strokeWidth={2} />
                        </div>
                        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>List your business</h1>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
                            Turn your Bookplus account into a business — no new sign-up. You'll still be able to book other businesses as a customer.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
                            {PERKS.map((p, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                    <Check size={16} strokeWidth={3} style={{ color: 'var(--gold-dark)', flexShrink: 0, marginTop: '2px' }} />
                                    <span>{p}</span>
                                </div>
                            ))}
                        </div>

                        {error && (
                            <div role="alert" style={{ background: 'var(--danger-bg,#fee2e2)', border: '1px solid #fca5a5', color: 'var(--danger-fg,#991b1b)', padding: '0.7rem 0.9rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', fontSize: '0.85rem' }}>{error}</div>
                        )}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Main service category</label>
                                <select value={category} onChange={e => setCategory(e.target.value)} required className="input">
                                    <option value="">Select your category</option>
                                    {MAIN_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {category === 'Other' && (
                                    <input type="text" value={customCategory} onChange={e => setCustomCategory(e.target.value)} required placeholder="e.g. Pet grooming, Tattoo studio…" className="input" style={{ marginTop: '0.75rem' }} />
                                )}
                            </div>
                            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', padding: '0.875rem' }}>
                                {loading ? 'Setting up…' : 'Create my business →'}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BecomeProvider;
