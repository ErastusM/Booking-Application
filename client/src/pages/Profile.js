import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { cloudinaryAvatar } from '../utils/cloudinary';
import PushToggle from '../components/PushToggle';
import AccountDangerZone from '../components/AccountDangerZone';
import { User, Lock, Bell, Globe, Info, Sun, Moon, Calendar, HelpCircle, ChevronRight, LogOut } from 'lucide-react';

// ── Shared bits for the settings list ──────────────────────────────────────
const iconTileStyle = {
    width: '32px', height: '32px', borderRadius: '9px', background: 'var(--surface-sunken)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0,
};
const fieldLabelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-secondary)', marginBottom: '0.35rem', letterSpacing: '0.04em', textTransform: 'uppercase' };
const hintStyle = { fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' };
const okMsg = { background: '#d1fae5', border: '1px solid #6ee7b7', color: '#065f46', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.85rem', fontSize: '0.85rem' };
const errMsg = { background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.85rem', fontSize: '0.85rem' };
const panelStyle = { background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border)', padding: '1.1rem 1.25rem' };

const SectionLabel = ({ children }) => (
    <p style={{ fontSize: '0.72rem', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '0 0 0.6rem 0.4rem' }}>{children}</p>
);

const Card = ({ children, style }) => (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: '1.5rem', ...style }}>{children}</div>
);

const SettingRow = ({ icon: Icon, label, value, onClick, trailing, isLast, danger }) => {
    const content = (
        <>
            <span style={iconTileStyle}><Icon size={17} strokeWidth={2} /></span>
            <span style={{ flex: 1, textAlign: 'left', fontSize: '0.92rem', fontWeight: '500', color: danger ? '#dc2626' : 'var(--charcoal)' }}>{label}</span>
            {value != null && <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{value}</span>}
            {trailing === undefined ? (onClick ? <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : null) : trailing}
        </>
    );
    const baseStyle = {
        display: 'flex', alignItems: 'center', gap: '0.85rem', width: '100%',
        padding: '0.95rem 1.1rem', background: 'none', border: 'none',
        borderBottom: isLast ? 'none' : '1px solid var(--border)',
        textAlign: 'left', fontFamily: 'var(--font-body)', color: 'var(--charcoal)', transition: 'background 0.15s',
    };
    if (!onClick) return <div style={baseStyle}>{content}</div>;
    return (
        <button
            type="button"
            onClick={onClick}
            style={{ ...baseStyle, cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
        >{content}</button>
    );
};

const Profile = () => {
    const { user, setUser, switchRole, logout } = useAuthContext();
    const { darkMode, toggleDarkMode } = useTheme();
    const navigate = useNavigate();

    // Which inline panel is expanded ('profile' | 'password' | 'notifications' | null)
    const [open, setOpen] = useState(null);
    const toggleOpen = (key) => setOpen(o => (o === key ? null : key));

    // Profile edit form
    const [formData, setFormData] = useState({ name: user?.name || '', phone: user?.phone || '', avatar: user?.avatar || '' });
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState('');
    const [error, setError] = useState('');

    // Change-password form
    const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
    const [pwBusy, setPwBusy] = useState(false);
    const [pwMsg, setPwMsg] = useState({ type: '', text: '' });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setSuccess(''); setError('');
        try {
            const response = await authService.updateProfile(formData);
            setUser(response.data.data);
            setSuccess('Profile updated successfully.');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const submitPassword = async (e) => {
        e.preventDefault();
        if (pw.newPassword !== pw.confirm) { setPwMsg({ type: 'error', text: 'New passwords do not match.' }); return; }
        setPwBusy(true); setPwMsg({ type: '', text: '' });
        try {
            const res = await authService.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
            setPwMsg({ type: 'success', text: res.data?.message || 'Password updated successfully.' });
            setPw({ currentPassword: '', newPassword: '', confirm: '' });
        } catch (err) {
            setPwMsg({ type: 'error', text: err.response?.data?.message || 'Could not update password' });
        } finally {
            setPwBusy(false);
        }
    };

    const handleLogout = () => { logout(); navigate('/'); };

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    const chevronFor = (key) => (
        <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open === key ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }} />
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh', paddingBottom: '5rem' }}>

            {/* Title */}
            <div style={{ paddingTop: 'clamp(4.5rem, 9vw, 7rem)', paddingBottom: '1.5rem', textAlign: 'center' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Profile</h1>
            </div>

            <div className="container" style={{ maxWidth: '640px' }}>

                {/* Header card — avatar, name, email */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
                    {user?.avatar ? (
                        <img src={cloudinaryAvatar(user.avatar)} alt={user.name} style={{ width: '54px', height: '54px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--gold)', flexShrink: 0 }} onError={e => { e.target.style.display = 'none'; }} />
                    ) : (
                        <div style={{ width: '54px', height: '54px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', fontWeight: '700', color: 'var(--ink)', fontFamily: 'var(--font-body)', flexShrink: 0 }}>
                            {getInitials(user?.name)}
                        </div>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <h2 style={{ fontFamily: 'var(--font-body)', fontSize: '1.05rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name}</h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</p>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: '0.68rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0.2rem 0.6rem', borderRadius: '99px', background: 'rgba(201,168,76,0.12)', color: 'var(--gold-dark)', border: '1px solid rgba(201,168,76,0.25)' }}>{user?.role}</span>
                </div>

                {/* Account-mode banner — keep switching / upgrading discoverable */}
                {user?.role === 'customer' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
                        <div>
                            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.2rem' }}>Grow your business on Bookplus</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>List your services and take bookings — you keep this customer account too.</p>
                        </div>
                        <button onClick={() => navigate('/become-provider')} className="btn-primary" style={{ padding: '0.65rem 1.4rem', whiteSpace: 'nowrap' }}>Become a provider →</button>
                    </div>
                )}
                {user?.role === 'provider' && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', background: 'var(--card-bg)', border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
                        <div>
                            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.2rem' }}>You're in customer view</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>Browsing and booking as a customer. Switch back to manage your business.</p>
                        </div>
                        <button onClick={() => { switchRole('provider'); navigate('/dashboard'); }} className="btn-primary" style={{ padding: '0.65rem 1.4rem', whiteSpace: 'nowrap' }}>Switch to provider view →</button>
                    </div>
                )}

                {/* ── Account ── */}
                <SectionLabel>Account</SectionLabel>
                <Card>
                    <SettingRow icon={User} label="Manage Profile" onClick={() => toggleOpen('profile')} trailing={chevronFor('profile')} />
                    {open === 'profile' && (
                        <div style={panelStyle}>
                            {success && <div style={okMsg}>{success}</div>}
                            {error && <div style={errMsg}>{error}</div>}
                            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                                <div>
                                    <label style={fieldLabelStyle}>Full name</label>
                                    <input className="input" type="text" name="name" value={formData.name} onChange={handleChange} required />
                                </div>
                                <div>
                                    <label style={fieldLabelStyle}>Email</label>
                                    <input className="input" type="email" value={user?.email || ''} disabled style={{ background: 'var(--warm-gray)', color: 'var(--text-muted)', cursor: 'not-allowed' }} />
                                    <p style={hintStyle}>Email address can't be changed.</p>
                                </div>
                                <div>
                                    <label style={fieldLabelStyle}>Phone number</label>
                                    <input className="input" type="tel" name="phone" value={formData.phone} onChange={handleChange} />
                                </div>
                                <div>
                                    <label style={fieldLabelStyle}>Avatar URL</label>
                                    <input className="input" type="url" name="avatar" value={formData.avatar} onChange={handleChange} placeholder="https://example.com/photo.jpg" />
                                    <p style={hintStyle}>Paste a link to your profile photo.</p>
                                </div>
                                <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '0.7rem 1.5rem', alignSelf: 'flex-start' }}>{loading ? 'Saving…' : 'Save changes'}</button>
                            </form>
                        </div>
                    )}

                    <SettingRow icon={Lock} label="Password & Security" onClick={() => toggleOpen('password')} trailing={chevronFor('password')} />
                    {open === 'password' && (
                        <div style={panelStyle}>
                            {pwMsg.text && <div style={pwMsg.type === 'success' ? okMsg : errMsg}>{pwMsg.text}</div>}
                            <form onSubmit={submitPassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                                <div>
                                    <label style={fieldLabelStyle}>Current password</label>
                                    <input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={e => setPw(p => ({ ...p, currentPassword: e.target.value }))} required />
                                </div>
                                <div>
                                    <label style={fieldLabelStyle}>New password</label>
                                    <input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={e => setPw(p => ({ ...p, newPassword: e.target.value }))} required />
                                    <p style={hintStyle}>At least 8 characters, with an uppercase letter, a number and a special character.</p>
                                </div>
                                <div>
                                    <label style={fieldLabelStyle}>Confirm new password</label>
                                    <input className="input" type="password" autoComplete="new-password" value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} required />
                                </div>
                                <button type="submit" disabled={pwBusy} className="btn-primary" style={{ padding: '0.7rem 1.5rem', alignSelf: 'flex-start' }}>{pwBusy ? 'Updating…' : 'Update password'}</button>
                            </form>
                        </div>
                    )}

                    <SettingRow icon={Bell} label="Notifications" onClick={() => toggleOpen('notifications')} trailing={chevronFor('notifications')} />
                    {open === 'notifications' && (
                        <div style={panelStyle}>
                            <PushToggle />
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
                                Turn on push to get booking confirmations and reminders instantly on this device. We'll still email you as a backup.
                            </p>
                        </div>
                    )}

                    <SettingRow icon={Globe} label="Language" value="English" isLast />
                </Card>

                {/* ── Preferences ── */}
                <SectionLabel>Preferences</SectionLabel>
                <Card>
                    <SettingRow icon={Info} label="About Us" onClick={() => navigate('/about')} />
                    <SettingRow icon={darkMode ? Moon : Sun} label="Theme" value={darkMode ? 'Dark' : 'Light'} onClick={toggleDarkMode} />
                    <SettingRow icon={Calendar} label="Appointments" onClick={() => navigate('/appointments')} isLast />
                </Card>

                {/* ── Support ── */}
                <SectionLabel>Support</SectionLabel>
                <Card>
                    <SettingRow icon={HelpCircle} label="Help Center" onClick={() => { window.location.href = 'mailto:info@bookplus.pro'; }} isLast />
                </Card>

                {/* Log out */}
                <Card>
                    <SettingRow icon={LogOut} label="Log out" danger onClick={handleLogout} trailing={null} isLast />
                </Card>

                <AccountDangerZone />
            </div>
        </div>
    );
};

export default Profile;
