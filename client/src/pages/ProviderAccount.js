import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { authService, reviewService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PushToggle from '../components/PushToggle';

const CLOUDINARY_CLOUD = 'dktit6s95';
const CLOUDINARY_PRESET = 'bookplus';

const uploadToCloudinary = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
        method: 'POST',
        body: fd,
    });
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    return data.secure_url;
};

const Stars = ({ rating }) => (
    <span>
        {[1, 2, 3, 4, 5].map(i => (
            <span key={i} style={{ color: i <= rating ? '#f59e0b' : '#d1d5db', fontSize: '1rem' }}>★</span>
        ))}
    </span>
);

const sidebarItems = [
    { id: 'profile', label: 'My profile' },
    { id: 'portfolio', label: 'Portfolio' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'settings', label: 'Personal settings' },
];

const ProviderAccount = () => {
    const { user, setUser } = useAuthContext();
    const { darkMode: darkModeOn, toggleDarkMode } = useTheme();
    const [section, setSection] = useState('profile');

    // Login & security
    const [settingsOpen, setSettingsOpen] = useState(null); // 'security' | 'appearance' | 'calendar'
    const [pwForm, setPwForm] = useState({ current: '', newPwd: '', confirm: '' });
    const [pwSaving, setPwSaving] = useState(false);
    const [pwMsg, setPwMsg] = useState({ text: '', ok: false });
    const [calendarEmbed, setCalendarEmbed] = useState('');
    const [calendarEmbedSaving, setCalendarEmbedSaving] = useState(false);
    const [calendarEmbedMsg, setCalendarEmbedMsg] = useState('');

    // Load google calendar embed url from user profile
    useEffect(() => {
        if (user?.googleCalendarEmbedUrl !== undefined) setCalendarEmbed(user.googleCalendarEmbedUrl || '');
    }, [user]);

    // Profile
    const [profileForm, setProfileForm] = useState({ name: user?.name || '', phone: user?.phone || '', address: user?.businessProfile?.address || '' });
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [profileSaving, setProfileSaving] = useState(false);
    const [profileMsg, setProfileMsg] = useState('');
    const [geoLoading, setGeoLoading] = useState(false);
    const avatarInputRef = useRef();

    const handleDetectLocation = () => {
        if (!navigator.geolocation) return;
        setGeoLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const { latitude, longitude } = pos.coords;
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
                        { headers: { 'Accept-Language': 'en' } }
                    );
                    const data = await res.json();
                    const addr = data.address || {};
                    const parts = [
                        addr.road || addr.pedestrian,
                        addr.house_number,
                        addr.suburb || addr.neighbourhood,
                        addr.city || addr.town || addr.village,
                        addr.state,
                        addr.country,
                    ].filter(Boolean);
                    setProfileForm(f => ({ ...f, address: parts.join(', ') }));
                } catch {
                    // silently fail
                } finally {
                    setGeoLoading(false);
                }
            },
            () => setGeoLoading(false),
            { timeout: 8000 }
        );
    };

    // Portfolio
    const [portfolio, setPortfolio] = useState({ images: [], instagramUrl: '' });
    const [portfolioLoading, setPortfolioLoading] = useState(false);
    const [portfolioSaving, setPortfolioSaving] = useState(false);
    const [portfolioMsg, setPortfolioMsg] = useState('');
    const portfolioInputRef = useRef();

    // Reviews
    const [reviews, setReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(null);
    const [reviewsLoading, setReviewsLoading] = useState(false);

    useEffect(() => {
        if (section === 'reviews' && reviews.length === 0) loadReviews();
        if (section === 'portfolio' && portfolio.images.length === 0) loadPortfolio();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section]);

    const loadPortfolio = async () => {
        setPortfolioLoading(true);
        try {
            const res = await authService.getProfile();
            const p = res.data.data?.portfolio || { images: [], instagramUrl: '' };
            setPortfolio({ images: p.images || [], instagramUrl: p.instagramUrl || '' });
        } catch { /* ignore */ } finally {
            setPortfolioLoading(false);
        }
    };

    const loadReviews = async () => {
        setReviewsLoading(true);
        try {
            const res = await reviewService.getProviderReviews();
            setReviews(res.data.data || []);
            setAvgRating(res.data.avgRating);
        } catch { /* ignore */ } finally {
            setReviewsLoading(false);
        }
    };

    const handleAvatarChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAvatarUploading(true);
        setProfileMsg('');
        try {
            const url = await uploadToCloudinary(file);
            const res = await authService.updateProfile({ name: profileForm.name, phone: profileForm.phone, avatar: url });
            setUser(res.data.data);
            setProfileMsg('Photo updated!');
        } catch { setProfileMsg('Photo upload failed — try again'); }
        finally { setAvatarUploading(false); }
    };

    const handleProfileSave = async (e) => {
        e.preventDefault();
        setProfileSaving(true);
        setProfileMsg('');
        try {
            const res = await authService.updateProfile(profileForm);
            setUser(res.data.data);
            setProfileMsg('Profile saved!');
        } catch { setProfileMsg('Save failed — try again'); }
        finally { setProfileSaving(false); }
    };

    const handlePortfolioImageAdd = async (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        setPortfolioSaving(true);
        setPortfolioMsg('Uploading...');
        try {
            const urls = await Promise.all(files.map(uploadToCloudinary));
            const updated = { ...portfolio, images: [...portfolio.images, ...urls].slice(0, 30) };
            await authService.updatePortfolio(updated);
            setPortfolio(updated);
            setPortfolioMsg('Images added!');
        } catch { setPortfolioMsg('Upload failed — try again'); }
        finally { setPortfolioSaving(false); }
    };

    const handleRemovePortfolioImage = async (idx) => {
        const updated = { ...portfolio, images: portfolio.images.filter((_, i) => i !== idx) };
        setPortfolio(updated);
        try { await authService.updatePortfolio(updated); } catch { /* ignore */ }
    };

    const handleInstagramSave = async () => {
        setPortfolioSaving(true);
        setPortfolioMsg('');
        try {
            await authService.updatePortfolio(portfolio);
            setPortfolioMsg('Instagram link saved!');
        } catch { setPortfolioMsg('Save failed'); }
        finally { setPortfolioSaving(false); }
    };

    const sideStyle = (id) => ({
        display: 'flex', alignItems: 'center', gap: '0.65rem',
        padding: '0.7rem 1rem', borderRadius: 'var(--radius-sm)',
        cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
        background: section === id ? 'rgba(201,168,76,0.1)' : 'transparent',
        color: section === id ? 'var(--gold-dark)' : 'var(--text-secondary)',
        fontWeight: section === id ? '600' : '400',
        fontFamily: 'Inter, sans-serif', fontSize: '0.9rem',
        transition: 'all 0.15s',
    });

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh', paddingTop: '5rem' }}>
            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '5rem' }}>

                {/* Back to dashboard */}
                <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                    ← Back to Dashboard
                </Link>

                <div className="provider-account-grid" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>

                    {/* Sidebar */}
                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 0.75rem', position: 'sticky', top: '90px' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0.5rem', marginBottom: '0.5rem' }}>Your account</p>
                        {sidebarItems.map(item => (
                            <button key={item.id} onClick={() => setSection(item.id)} style={sideStyle(item.id)}>
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div>

                        {/* ── MY PROFILE ── */}
                        {section === 'profile' && (
                            <div>
                                <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.75rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>
                                    My profile
                                    <span style={{ marginLeft: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#d1fae5', color: '#065f46', fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.7rem', borderRadius: '99px', verticalAlign: 'middle' }}>
                                        ● Online
                                    </span>
                                </h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Edit and manage the content of your online profile</p>

                                <div className="provider-profile-two-col">
                                    {/* Left - photo + name */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '2rem', textAlign: 'center' }}>
                                        <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1.75rem' }}>
                                            <div style={{ width: '90px', height: '90px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: '2rem', fontWeight: '700', color: 'var(--ink)' }}>
                                                {user?.avatar
                                                    ? <img src={user.avatar} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    : user?.name?.charAt(0).toUpperCase()
                                                }
                                            </div>
                                        </div>
                                        <button onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} style={{ border: '1px solid var(--border)', background: 'white', color: 'var(--text-secondary)', padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontFamily: 'Inter, sans-serif', marginBottom: '1.25rem' }}>
                                            {avatarUploading ? 'Uploading...' : 'Edit photo'}
                                        </button>
                                        <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />

                                        <p style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.3rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>{user?.name}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>No reviews yet</p>
                                        {user?.providerCategory && (
                                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{user.providerCategory}</p>
                                        )}

                                        <form onSubmit={handleProfileSave} style={{ marginTop: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Full Name</label>
                                                <input value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} className="input" />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Phone</label>
                                                <input value={profileForm.phone} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} className="input" />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Business Address</label>
                                                <button
                                                    type="button"
                                                    onClick={handleDetectLocation}
                                                    disabled={geoLoading}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', marginBottom: '0.5rem', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', background: 'rgba(201,168,76,0.08)', color: 'var(--gold-dark)', fontSize: '0.75rem', fontWeight: '600', cursor: geoLoading ? 'not-allowed' : 'pointer', opacity: geoLoading ? 0.7 : 1 }}
                                                >
                                                    {geoLoading ? <span style={{ display: 'inline-block', width: '11px', height: '11px', border: '2px solid rgba(201,168,76,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : '📡'}
                                                    {geoLoading ? 'Detecting…' : 'Use current location'}
                                                </button>
                                                <textarea value={profileForm.address} onChange={e => setProfileForm(p => ({ ...p, address: e.target.value }))} className="input" rows={2} placeholder="e.g. 12 Independence Ave, Windhoek" style={{ resize: 'vertical', fontSize: '0.875rem' }} />
                                            </div>
                                            {profileMsg && <p style={{ fontSize: '0.8rem', color: profileMsg.includes('fail') ? '#ef4444' : '#065f46' }}>{profileMsg}</p>}
                                            <button type="submit" disabled={profileSaving} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                                {profileSaving ? 'Saving...' : 'Save changes'}
                                            </button>
                                        </form>
                                    </div>

                                    {/* Right - info cards */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.1rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '1rem' }}>Account details</h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Email</span>
                                                    <span className="acct-value">{user?.email}</span>
                                                </div>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Phone</span>
                                                    <span className="acct-value">{user?.phone}</span>
                                                </div>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Category</span>
                                                    <span className="acct-value">{user?.providerCategory || '—'}</span>
                                                </div>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Verified</span>
                                                    <span className="acct-value" style={{ color: user?.isVerified ? '#065f46' : '#92400e', fontWeight: '600' }}>{user?.isVerified ? 'Verified' : 'Pending'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.1rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>Online profile visibility</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Your profile is visible to clients searching for providers on Bookplus.</p>
                                            <Link to={`/providers/${user?.id}`} target="_blank" style={{ color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none', fontSize: '0.875rem' }}>View public profile →</Link>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── PORTFOLIO ── */}
                        {section === 'portfolio' && (
                            <div>
                                <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.75rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Portfolio</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Showcase your best work to attract more clients</p>

                                {portfolioLoading ? (
                                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                                ) : (
                                    <>
                                        {/* Upload images */}
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                                                <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)' }}>Images ({portfolio.images.length}/30)</h3>
                                                <button onClick={() => portfolioInputRef.current?.click()} disabled={portfolioSaving} className="btn-primary" style={{ padding: '0.5rem 1.25rem', fontSize: '0.875rem' }}>
                                                    {portfolioSaving ? 'Uploading...' : '+ Add photos'}
                                                </button>
                                            </div>
                                            <input ref={portfolioInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={handlePortfolioImageAdd} style={{ display: 'none' }} />

                                            {portfolio.images.length === 0 ? (
                                                <div
                                                    onClick={() => portfolioInputRef.current?.click()}
                                                    style={{ border: '2px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: '3rem', textAlign: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}
                                                >
                                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🖼️</div>
                                                    <p style={{ fontWeight: '500', marginBottom: '0.25rem' }}>Add your images here</p>
                                                    <p style={{ fontSize: '0.8rem' }}>JPG, PNG, AVIF, WEBP · max 10 MB each</p>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
                                                    {portfolio.images.map((url, i) => (
                                                        <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                                            <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                            <button
                                                                onClick={() => handleRemovePortfolioImage(i)}
                                                                style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                            >×</button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {portfolioMsg && <p style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: portfolioMsg.includes('fail') ? '#ef4444' : '#065f46' }}>{portfolioMsg}</p>}
                                        </div>

                                        {/* Instagram link */}
                                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>📷 Instagram feed</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Link your Instagram profile to showcase your latest work automatically.</p>
                                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                <input
                                                    value={portfolio.instagramUrl}
                                                    onChange={e => setPortfolio(p => ({ ...p, instagramUrl: e.target.value }))}
                                                    placeholder="https://instagram.com/yourusername"
                                                    className="input"
                                                    style={{ flex: 1 }}
                                                />
                                                <button onClick={handleInstagramSave} disabled={portfolioSaving} className="btn-primary" style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}>Save</button>
                                            </div>
                                            {portfolio.instagramUrl && (
                                                <a href={portfolio.instagramUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: '0.75rem', color: 'var(--gold-dark)', fontSize: '0.85rem', fontWeight: '600' }}>
                                                    View profile →
                                                </a>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── REVIEWS ── */}
                        {section === 'reviews' && (
                            <div>
                                <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.75rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Reviews</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Star ratings and reviews left by clients after their visit</p>

                                {reviewsLoading ? (
                                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                                ) : reviews.length === 0 ? (
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '5rem 2rem', textAlign: 'center' }}>
                                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⭐</div>
                                        <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.4rem', fontWeight: '600' }}>No reviews yet</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Clients have not provided feedback for their appointments yet.</p>
                                    </div>
                                ) : (
                                    <>
                                        {avgRating && (
                                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '3rem', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1 }}>{avgRating}</span>
                                                <div>
                                                    <Stars rating={Math.round(avgRating)} />
                                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
                                                </div>
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {reviews.map(r => (
                                                <div key={r._id} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700', fontSize: '0.8rem', color: 'var(--ink)', flexShrink: 0, overflow: 'hidden' }}>
                                                                {r.customer?.avatar
                                                                    ? <img src={r.customer.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                                    : r.customer?.name?.charAt(0).toUpperCase()
                                                                }
                                                            </div>
                                                            <div>
                                                                <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{r.customer?.name}</p>
                                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{r.service?.name}</p>
                                                            </div>
                                                        </div>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <Stars rating={r.rating} />
                                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>
                                                                {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    {r.comment && <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>{r.comment}</p>}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── PERSONAL SETTINGS ── */}
                        {section === 'settings' && (
                            <div>
                                <h1 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '1.75rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Personal settings</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Manage settings for your personal account</p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                    {/* Personal info */}
                                    <div onClick={() => setSection('profile')} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', cursor: 'pointer', transition: 'box-shadow 0.2s', display: 'flex', alignItems: 'center', gap: '1.25rem' }}
                                        onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                                        onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                                    >
                                        <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>👤</div>
                                        <div style={{ flex: 1 }}>
                                            <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Personal info</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Customise your personal details and how we can contact you</p>
                                        </div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem' }}>›</span>
                                    </div>

                                    {/* Login & security */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: `1px solid ${settingsOpen === 'security' ? 'var(--gold)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div onClick={() => setSettingsOpen(s => s === 'security' ? null : 'security')} style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>🔐</div>
                                            <div style={{ flex: 1 }}>
                                                <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Login &amp; security</h3>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Update your password and secure your account</p>
                                            </div>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem', transition: 'transform 0.2s', transform: settingsOpen === 'security' ? 'rotate(90deg)' : 'none' }}>›</span>
                                        </div>
                                        {settingsOpen === 'security' && (
                                            <div style={{ padding: '0 1.5rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '1rem 0 1rem' }}>Enter your current password, then choose a new one.</p>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px' }}>
                                                    {[['Current password', 'current'], ['New password', 'newPwd'], ['Confirm new password', 'confirm']].map(([label, key]) => (
                                                        <div key={key}>
                                                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{label}</label>
                                                            <input type="password" className="input" value={pwForm[key]} onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))} />
                                                        </div>
                                                    ))}
                                                    {pwMsg.text && <p style={{ fontSize: '0.8rem', color: pwMsg.ok ? '#065f46' : '#dc2626' }}>{pwMsg.text}</p>}
                                                    <button
                                                        onClick={async () => {
                                                            if (pwForm.newPwd !== pwForm.confirm) { setPwMsg({ text: 'Passwords do not match', ok: false }); return; }
                                                            setPwSaving(true); setPwMsg({ text: '', ok: false });
                                                            try {
                                                                await authService.changePassword({ currentPassword: pwForm.current, newPassword: pwForm.newPwd });
                                                                setPwMsg({ text: 'Password changed successfully!', ok: true });
                                                                setPwForm({ current: '', newPwd: '', confirm: '' });
                                                            } catch (err) {
                                                                setPwMsg({ text: err.response?.data?.message || 'Failed — try again', ok: false });
                                                            } finally { setPwSaving(false); }
                                                        }}
                                                        disabled={pwSaving || !pwForm.current || !pwForm.newPwd || !pwForm.confirm}
                                                        className="btn-primary"
                                                        style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem', opacity: (!pwForm.current || !pwForm.newPwd || !pwForm.confirm) ? 0.4 : 1 }}
                                                    >{pwSaving ? 'Saving...' : 'Change password'}</button>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Appearance */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: `1px solid ${settingsOpen === 'appearance' ? 'var(--gold)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div onClick={() => setSettingsOpen(s => s === 'appearance' ? null : 'appearance')} style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>🎨</div>
                                            <div style={{ flex: 1 }}>
                                                <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Appearance</h3>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Select the look and feel of your platform</p>
                                            </div>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem', transition: 'transform 0.2s', transform: settingsOpen === 'appearance' ? 'rotate(90deg)' : 'none' }}>›</span>
                                        </div>
                                        {settingsOpen === 'appearance' && (
                                            <div style={{ padding: '0 1.5rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                                                <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: '360px' }}>
                                                    <div>
                                                        <p style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem', marginBottom: '0.2rem' }}>Dark mode</p>
                                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{darkModeOn ? 'Currently on' : 'Currently off'}</p>
                                                    </div>
                                                    <button
                                                        onClick={toggleDarkMode}
                                                        style={{
                                                            width: '52px', height: '28px', borderRadius: '99px', border: 'none', cursor: 'pointer',
                                                            background: darkModeOn ? 'var(--gold)' : '#d1d5db',
                                                            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                                                        }}
                                                    >
                                                        <span style={{ position: 'absolute', top: '3px', left: darkModeOn ? '27px' : '3px', width: '22px', height: '22px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                                                    </button>
                                                </div>
                                                <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                                                    <PushToggle />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Calendar */}
                                    <div style={{ background: 'white', borderRadius: 'var(--radius)', border: `1px solid ${settingsOpen === 'calendar' ? 'var(--gold)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div onClick={() => setSettingsOpen(s => s === 'calendar' ? null : 'calendar')} style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>📅</div>
                                            <div style={{ flex: 1 }}>
                                                <h3 style={{ fontFamily: 'Inter, sans-serif', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Google Calendar</h3>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Embed your Google Calendar in the dashboard</p>
                                            </div>
                                            <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem', transition: 'transform 0.2s', transform: settingsOpen === 'calendar' ? 'rotate(90deg)' : 'none' }}>›</span>
                                        </div>
                                        {settingsOpen === 'calendar' && (
                                            <div style={{ padding: '0 1.5rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '1rem 0 0.75rem' }}>
                                                    In Google Calendar, open <strong>Settings → Settings for my calendars → [your calendar] → Integrate calendar</strong> and copy the <em>Embed URL</em> (not the full HTML — just the URL inside <code>src="..."</code>).
                                                </p>
                                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                    <input
                                                        className="input"
                                                        value={calendarEmbed}
                                                        onChange={e => setCalendarEmbed(e.target.value)}
                                                        placeholder="https://calendar.google.com/calendar/embed?src=..."
                                                        style={{ flex: 1, fontSize: '0.85rem' }}
                                                    />
                                                    <button
                                                        onClick={async () => {
                                                            setCalendarEmbedSaving(true); setCalendarEmbedMsg('');
                                                            try {
                                                                const res = await authService.updateProfile({ googleCalendarEmbedUrl: calendarEmbed.trim() });
                                                                setUser(res.data.data);
                                                                setCalendarEmbedMsg('Saved!');
                                                            } catch { setCalendarEmbedMsg('Save failed'); }
                                                            finally { setCalendarEmbedSaving(false); }
                                                        }}
                                                        disabled={calendarEmbedSaving}
                                                        className="btn-primary"
                                                        style={{ padding: '0.65rem 1.25rem', fontSize: '0.875rem', whiteSpace: 'nowrap' }}
                                                    >{calendarEmbedSaving ? 'Saving...' : 'Save'}</button>
                                                </div>
                                                {calendarEmbedMsg && <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: calendarEmbedMsg === 'Saved!' ? '#065f46' : '#dc2626' }}>{calendarEmbedMsg}</p>}
                                                {calendarEmbed && <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>✓ Google Calendar is connected. Switch to the Google view in your Dashboard → Calendar tab.</p>}
                                            </div>
                                        )}
                                    </div>

                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </div>
    );
};

export default ProviderAccount;
