import React, { useState } from 'react';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import PushToggle from '../components/PushToggle';

const Profile = () => {
    const { user, setUser } = useAuthContext();
    const [formData, setFormData] = useState({
        name: user?.name || '',
        phone: user?.phone || '',
        avatar: user?.avatar || '',
    });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setSuccess('');
        setError('');
        try {
            const response = await authService.updateProfile(formData);
            setUser(response.data.data);
            setSuccess('Profile updated successfully!');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const getInitials = (name) => name
        ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
        : '?';

    const roleColors = {
        admin: { bg: '#fef3c7', color: '#92400e' },
        provider: { bg: '#dbeafe', color: '#1e40af' },
        customer: { bg: '#d1fae5', color: '#065f46' },
    };
    const roleStyle = roleColors[user?.role] || roleColors.customer;

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{
                background: 'var(--ink)',
                paddingTop: '9rem',
                paddingBottom: '3rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute', inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 30% 50%, rgba(201,168,76,0.1) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600',
                        letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem',
                    }}>Account</p>
                    <h1 style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 'clamp(2rem, 4vw, 3rem)',
                        fontWeight: '700', color: 'white',
                    }}>
                        My Profile
                    </h1>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                <div className="profile-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: '300px 1fr',
                    gap: '2rem',
                    alignItems: 'start',
                }}>

                    {/* Left — avatar card */}
                    <div className="profile-sticky" style={{
                        background: 'var(--card-bg)',
                        borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--shadow-sm)',
                        padding: '2rem',
                        textAlign: 'center',
                        position: 'sticky',
                        top: '100px',
                    }}>
                        <div style={{ marginBottom: '1.25rem' }}>
                            {formData.avatar ? (
                                <img
                                    src={formData.avatar}
                                    alt="Avatar"
                                    style={{
                                        width: '96px', height: '96px', borderRadius: '50%',
                                        objectFit: 'cover', border: '3px solid var(--gold)',
                                        margin: '0 auto', display: 'block',
                                    }}
                                    onError={e => { e.target.style.display = 'none'; }}
                                />
                            ) : (
                                <div style={{
                                    width: '96px', height: '96px', borderRadius: '50%',
                                    background: 'var(--gold)', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', fontSize: '2rem', fontWeight: '700',
                                    color: 'var(--charcoal)', margin: '0 auto',
                                    fontFamily: 'var(--font-body)',
                                }}>
                                    {getInitials(user?.name)}
                                </div>
                            )}
                        </div>

                        <h2 style={{
                            fontFamily: 'var(--font-body)', fontSize: '1.3rem',
                            fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem',
                        }}>
                            {user?.name}
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                            {user?.email}
                        </p>
                        <span style={{
                            display: 'inline-block', padding: '0.25rem 0.875rem',
                            borderRadius: '99px', fontSize: '0.75rem', fontWeight: '600',
                            textTransform: 'capitalize', background: roleStyle.bg, color: roleStyle.color,
                        }}>
                            {user?.role}
                        </span>

                        {user?.phone && (
                            <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>📞</span>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{user.phone}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right — edit form */}
                    <div style={{
                        background: 'var(--card-bg)', borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '2rem',
                    }}>
                        <h2 style={{
                            fontFamily: 'var(--font-body)', fontSize: '1.3rem',
                            fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem',
                        }}>
                            Edit Information
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                            Update your personal details below.
                        </p>

                        {success && (
                            <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                                {success}
                            </div>
                        )}
                        {error && (
                            <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {[
                                { name: 'name', label: 'Full Name', type: 'text', disabled: false },
                                { name: 'email', label: 'Email Address', type: 'email', disabled: true, hint: 'Email address cannot be changed.' },
                                { name: 'phone', label: 'Phone Number', type: 'tel', disabled: false },
                                { name: 'avatar', label: 'Avatar URL', type: 'url', disabled: false, placeholder: 'https://example.com/photo.jpg', hint: 'Paste a link to your profile photo.' },
                            ].map(field => (
                                <div key={field.name}>
                                    <label style={{
                                        display: 'block', fontSize: '0.8rem', fontWeight: '600',
                                        color: 'var(--text-secondary)', marginBottom: '0.5rem',
                                        letterSpacing: '0.05em', textTransform: 'uppercase',
                                    }}>{field.label}</label>
                                    <input
                                        type={field.type}
                                        name={field.name}
                                        value={field.name === 'email' ? user?.email : formData[field.name]}
                                        onChange={handleChange}
                                        required={field.name === 'name'}
                                        disabled={field.disabled}
                                        placeholder={field.placeholder}
                                        className="input"
                                        style={field.disabled ? { background: 'var(--warm-gray)', color: 'var(--text-muted)', cursor: 'not-allowed' } : {}}
                                    />
                                    {field.hint && <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{field.hint}</p>}
                                </div>
                            ))}

                            <div style={{ paddingTop: '0.5rem' }}>
                                <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '0.875rem 2.5rem' }}>
                                    {loading ? 'Saving...' : 'Save Changes →'}
                                </button>
                            </div>
                        </form>

                        <div style={{ borderTop: '1px solid var(--border)', marginTop: '1.5rem', paddingTop: '0.5rem' }}>
                            <PushToggle />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Profile;