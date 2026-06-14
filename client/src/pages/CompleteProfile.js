import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { authService } from '../services';

const CompleteProfile = () => {
    const { user, setUser } = useAuthContext();
    const navigate = useNavigate();
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!phone.trim()) {
            setError('Please enter your phone number');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const response = await authService.updateProfile({ phone, name: user?.name, avatar: user?.avatar });
            setUser(response.data.data);
            if (user?.role === 'provider') navigate('/dashboard');
            else if (user?.role === 'admin') navigate('/admin/dashboard');
            else navigate('/');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to save phone number');
        } finally {
            setLoading(false);
        }
    };

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    return (
        <div style={{ minHeight: '100vh', background: 'var(--off-white)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem' }}>
            <div style={{ width: '100%', maxWidth: '440px' }} className="fade-up">

                {/* Card */}
                <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>

                    {/* Gold top bar */}
                    <div style={{ height: '4px', background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))' }} />

                    <div style={{ padding: '2.5rem' }}>
                        {/* Avatar */}
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                            {user?.avatar ? (
                                <img src={user.avatar} alt={user.name} style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', margin: '0 auto', display: 'block', marginBottom: '1rem' }} />
                            ) : (
                                <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: '2rem', fontWeight: '700', color: 'var(--ink)', margin: '0 auto', marginBottom: '1rem' }}>
                                    {getInitials(user?.name)}
                                </div>
                            )}
                            <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.35rem' }}>
                                One last step!
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                Hi {user?.name?.split(' ')[0]}! We just need your phone number to complete your profile.
                            </p>
                        </div>

                        {error && (
                            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.85rem' }}>
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    Phone Number
                                </label>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                    placeholder="+1 234 567 8900"
                                    required
                                    className="input"
                                    autoFocus
                                />
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                    Used for appointment reminders and provider contact.
                                </p>
                            </div>

                            <button type="submit" disabled={loading} className="btn-primary" style={{ width: '100%', padding: '0.875rem' }}>
                                {loading ? 'Saving...' : 'Complete Profile →'}
                            </button>
                        </form>

                        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="16" alt="Google" />
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Signed in as {user?.email}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CompleteProfile;