import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService, myProfileService, myStatsService, providerMarketService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import PushToggle from '../components/PushToggle';
import { uploadToCloudinary } from '../utils/uploadImage';
import { cloudinaryAvatar } from '../utils/cloudinary';

// A team member's Account, in the owner's Account layout: the same side menu,
// headings and cards, with the sections a member has — My profile, My working
// hours, My reviews, Personal settings. Business-level things (business name,
// address, portfolio, locations, cancellation policy) are the owner's alone.

const sidebarItems = [
    { id: 'profile', label: 'My profile' },
    { id: 'hours', label: 'My working hours' },
    { id: 'reviews', label: 'My reviews' },
    { id: 'settings', label: 'Personal settings' },
];
const cardStyle = { background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' };
const h1 = { fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' };
const sub = { color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' };
const labelStyle = { display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' };
const Stars = ({ rating }) => <span aria-label={`${rating} out of 5`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} aria-hidden="true" style={{ color: i <= rating ? '#f59e0b' : 'var(--border)' }}>★</span>)}</span>;

const MemberAccount = () => {
    const { user, logout } = useAuthContext();
    const navigate = useNavigate();
    const toast = useToast();
    const { darkMode, toggleDarkMode } = useTheme();
    const [section, setSection] = useState('profile');
    const [profile, setProfile] = useState(null);
    const [saving, setSaving] = useState('');
    const [stats, setStats] = useState(null);
    const [reviews, setReviews] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(null);
    const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
    const [pwMsg, setPwMsg] = useState({ text: '', ok: false });

    useEffect(() => {
        myProfileService.get().then((r) => {
            const d = r.data.data || {};
            setProfile({ ...d, languagesText: (d.languages || []).join(', ') });
        }).catch(() => setProfile(false));
        myStatsService.get(30).then((r) => setStats(r.data.data)).catch(() => setStats(false));
    }, []);
    useEffect(() => {
        if (section !== 'reviews' || reviews !== null || !profile?._id || !user?.staffOf) return;
        providerMarketService.getProviderStaffReviews(user.staffOf, profile._id)
            .then((r) => setReviews({ list: r.data.data || [], avg: r.data.avgRating, total: r.data.total }))
            .catch(() => setReviews({ list: [], avg: null, total: 0 }));
    }, [section, reviews, profile, user]);

    const saveProfile = async () => {
        if (!profile.name?.trim()) { toast('Your name can’t be empty', 'error'); return; }
        setSaving('profile');
        try {
            const languages = profile.languagesText.split(',').map((s) => s.trim()).filter(Boolean);
            const res = await myProfileService.update({ name: profile.name.trim(), phone: profile.phone || '', bio: profile.bio || '', languages });
            setProfile((p) => ({ ...p, ...res.data.data, languagesText: (res.data.data?.languages || languages).join(', ') }));
            toast('Profile saved', 'success');
        } catch (err) { toast(err.response?.data?.message || 'Could not save your profile', 'error'); } finally { setSaving(''); }
    };
    const uploadPhoto = async (e) => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file) return;
        setSaving('photo');
        try {
            const url = await uploadToCloudinary(file);
            const res = await myProfileService.update({ photoUrl: url });
            setProfile((p) => ({ ...p, photoUrl: res.data.data?.photoUrl || url }));
            toast('Photo updated', 'success');
        } catch { toast('Could not upload the photo', 'error'); } finally { setSaving(''); }
    };
    const changePassword = async () => {
        if (pw.next !== pw.confirm) { setPwMsg({ text: 'Passwords do not match', ok: false }); return; }
        setSaving('pw'); setPwMsg({ text: '', ok: false });
        try {
            await authService.changePassword({ currentPassword: pw.current, newPassword: pw.next });
            setPwMsg({ text: 'Password changed.', ok: true }); setPw({ current: '', next: '', confirm: '' });
        } catch (err) { setPwMsg({ text: err.response?.data?.message || 'Failed — try again', ok: false }); } finally { setSaving(''); }
    };

    const sideStyle = (id) => ({
        width: '100%', textAlign: 'left', display: 'block', padding: '0.6rem 0.75rem', minHeight: '40px', background: section === id ? 'rgba(240,62,22,0.1)' : 'none',
        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem',
        fontWeight: section === id ? '600' : '400', color: section === id ? 'var(--gold-dark)' : 'var(--text-secondary)', marginBottom: '0.15rem',
    });
    const settingsCard = (id, title, text, body) => (
        <div style={{ ...cardStyle, border: `1px solid ${settingsOpen === id ? 'var(--gold)' : 'var(--border)'}`, overflow: 'hidden' }}>
            <button type="button" onClick={() => setSettingsOpen((s) => (s === id ? null : id))} aria-expanded={settingsOpen === id} style={{ width: '100%', padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem', background: 'none', border: 'none', textAlign: 'left', fontFamily: 'var(--font-body)' }}>
                <div style={{ flex: 1 }}>
                    <h3 style={{ fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem', fontSize: '1rem' }}>{title}</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>{text}</p>
                </div>
                <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '1.2rem', transition: 'transform 0.2s', transform: settingsOpen === id ? 'rotate(90deg)' : 'none' }}>›</span>
            </button>
            {settingsOpen === id && <div style={{ padding: '0 1.5rem 1.5rem', borderTop: '1px solid var(--border)' }}>{body}</div>}
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh', paddingTop: 'calc(56px + 1.5rem)' }}>
            <div className="container" style={{ paddingTop: '0.5rem', paddingBottom: '4.5rem' }}>
                <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                    ← Back to Calendar
                </Link>
                <div className="provider-account-grid" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>
                    <div className="provider-account-sidebar" style={{ ...cardStyle, padding: '1.25rem 0.75rem', position: 'sticky', top: 'calc(90px + env(safe-area-inset-top, 0px))' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0.5rem', marginBottom: '0.5rem' }}>Your account</p>
                        {sidebarItems.map((item) => (
                            <button key={item.id} onClick={() => (item.id === 'hours' ? navigate('/dashboard?tab=availability') : setSection(item.id))} style={sideStyle(item.id)}>{item.label}</button>
                        ))}
                    </div>

                    <div data-testid="member-account">
                        {section === 'profile' && (
                            <div>
                                <h1 style={h1}>My profile</h1>
                                <p style={sub}>How clients see you when they choose who to book</p>
                                {profile === null ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : profile === false ? (
                                    <p style={{ color: 'var(--text-muted)' }}>Your profile couldn’t be loaded. Ask the owner to check your team access.</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div style={{ ...cardStyle, padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem', textAlign: 'center' }}>
                                            {profile.photoUrl
                                                ? <img src={cloudinaryAvatar(profile.photoUrl, 192)} alt="" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover' }} />
                                                : <span aria-hidden="true" style={{ width: 96, height: 96, borderRadius: '50%', background: profile.color || 'var(--gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '2rem' }}>{(profile.name || '?').trim().charAt(0).toUpperCase()}</span>}
                                            <label className="btn-outline" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', cursor: 'pointer', opacity: saving === 'photo' ? 0.6 : 1 }}>
                                                <input type="file" accept="image/*" onChange={uploadPhoto} disabled={saving === 'photo'} style={{ display: 'none' }} />
                                                {saving === 'photo' ? 'Uploading…' : 'Edit photo'}
                                            </label>
                                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--charcoal)' }}>{profile.name}</div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{profile.role || 'Team member'} · set by your business</div>
                                        </div>
                                        <div style={{ ...cardStyle, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                            <div><label style={labelStyle} htmlFor="ma-name">Name clients see</label><input id="ma-name" className="input" value={profile.name || ''} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} /></div>
                                            <div><label style={labelStyle} htmlFor="ma-phone">Phone</label><input id="ma-phone" className="input" type="tel" value={profile.phone || ''} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} /></div>
                                            <div><label style={labelStyle} htmlFor="ma-bio">About you</label><textarea id="ma-bio" className="input" rows={3} maxLength={300} value={profile.bio || ''} onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))} style={{ resize: 'vertical' }} /></div>
                                            <div><label style={labelStyle} htmlFor="ma-lang">Languages</label><input id="ma-lang" className="input" value={profile.languagesText} onChange={(e) => setProfile((p) => ({ ...p, languagesText: e.target.value }))} placeholder="e.g. English, Oshiwambo" /></div>
                                            <button onClick={saveProfile} disabled={saving === 'profile'} className="btn-primary" style={{ alignSelf: 'flex-start', padding: '0.65rem 1.5rem' }} data-testid="member-save-profile">{saving === 'profile' ? 'Saving…' : 'Save changes'}</button>
                                        </div>
                                        {stats && (
                                            <div style={{ ...cardStyle, padding: '1.5rem' }}>
                                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 600, color: 'var(--charcoal)', marginBottom: '0.9rem' }}>Last 30 days</h3>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                                                    {[['Completed', stats.appointments ?? '—'], ['Coming up', stats.upcoming ?? '—'], ['Rating', stats.rating != null ? `${stats.rating} ★` : '—']].map(([l, v]) => (
                                                        <div key={l} style={{ padding: '0.8rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                                                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                                                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--charcoal)' }}>{v}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {section === 'reviews' && (
                            <div>
                                <h1 style={h1}>My reviews</h1>
                                <p style={sub}>What clients said after a visit with you</p>
                                {reviews === null ? <p style={{ color: 'var(--text-muted)' }}>Loading…</p> : reviews.list.length === 0 ? (
                                    <div style={{ ...cardStyle, padding: '4rem 2rem', textAlign: 'center' }}>
                                        <p style={{ fontSize: '1.05rem', color: 'var(--charcoal)', fontWeight: 600, marginBottom: '0.3rem' }}>No reviews yet</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Reviews appear here after clients rate a visit with you.</p>
                                    </div>
                                ) : (
                                    <>
                                        {reviews.avg != null && (
                                            <div style={{ ...cardStyle, padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <span style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: '600', color: 'var(--charcoal)', lineHeight: 1 }}>{reviews.avg}</span>
                                                <div><Stars rating={Math.round(reviews.avg)} /><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{reviews.total} review{reviews.total !== 1 ? 's' : ''}</p></div>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {reviews.list.map((r) => (
                                                <div key={r._id} style={{ ...cardStyle, padding: '1.25rem 1.5rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.5rem' }}>
                                                        <div><p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{r.customer?.name || 'Client'}</p><p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{r.service?.name}</p></div>
                                                        <div style={{ textAlign: 'right' }}><Stars rating={r.rating} /><p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                                                    </div>
                                                    {r.comment && <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>{r.comment}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {section === 'settings' && (
                            <div>
                                <h1 style={h1}>Personal settings</h1>
                                <p style={sub}>Manage settings for your own login</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {settingsCard('security', 'Login & security', 'Change your password', (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px', marginTop: '1rem' }}>
                                            {[['Current password', 'current', 'current-password'], ['New password', 'next', 'new-password'], ['Confirm new password', 'confirm', 'new-password']].map(([l, k, ac]) => (
                                                <div key={k}><label style={labelStyle} htmlFor={`pw-${k}`}>{l}</label><input id={`pw-${k}`} type="password" autoComplete={ac} className="input" value={pw[k]} onChange={(e) => setPw((f) => ({ ...f, [k]: e.target.value }))} /></div>
                                            ))}
                                            {pwMsg.text && <p role="status" style={{ fontSize: '0.8rem', color: pwMsg.ok ? 'var(--success)' : 'var(--danger)' }}>{pwMsg.text}</p>}
                                            <button onClick={changePassword} disabled={saving === 'pw' || !pw.current || !pw.next || !pw.confirm} className="btn-primary" style={{ padding: '0.65rem 1.5rem', alignSelf: 'flex-start' }}>{saving === 'pw' ? 'Saving…' : 'Change password'}</button>
                                        </div>
                                    ))}
                                    {settingsCard('appearance', 'Appearance & notifications', 'Dark mode and alerts on this device', (
                                        <div>
                                            <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '360px' }}>
                                                <div><p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Dark mode</p><p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{darkMode ? 'Currently on' : 'Currently off'}</p></div>
                                                <button onClick={toggleDarkMode} role="switch" aria-checked={!!darkMode} aria-label="Dark mode" style={{ width: '52px', height: '28px', borderRadius: '99px', border: 'none', cursor: 'pointer', background: darkMode ? 'var(--gold)' : 'var(--warm-gray)', position: 'relative', flexShrink: 0 }}>
                                                    <span style={{ position: 'absolute', top: '3px', left: '3px', width: '22px', height: '22px', borderRadius: '50%', background: 'white', transform: darkMode ? 'translateX(24px)' : 'none', transition: 'transform 0.2s' }} />
                                                </button>
                                            </div>
                                            <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}><PushToggle /></div>
                                        </div>
                                    ))}
                                    <div style={{ ...cardStyle, padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                        <div style={{ flex: 1, minWidth: '160px' }}><h3 style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '1rem' }}>Legal</h3><p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Terms of Service and Privacy Policy.</p></div>
                                        <Link to="/terms" style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Terms →</Link>
                                        <Link to="/privacy-policy" style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Privacy →</Link>
                                    </div>
                                    <button onClick={logout} style={{ minHeight: '48px', padding: '0.75rem', background: '#fee2e2', border: 'none', borderRadius: 'var(--radius-sm)', color: '#dc2626', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Sign out</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MemberAccount;
