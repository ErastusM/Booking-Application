import React, { useEffect, useState, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authService, reviewService, myProfileService, myStatsService, providerMarketService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PushToggle from '../components/PushToggle';
import AccountDangerZone from '../components/AccountDangerZone';
import YourDataCard from '../components/YourDataCard';
import { openConsentSettings } from '@bookplus/api-client';
import MapPicker, { MAPS_KEY, reverseGeocode } from '../components/MapPicker';
import LocationsManager from '../components/LocationsManager';
import { cloudinaryAvatar } from '../utils/cloudinary';
// App-styled replacement for the native <select>, so the picker wears the app's colours.
import { Select, Field } from '@bookplus/ui';
import { useToast } from '../components/Toast';
import PortfolioPhotos, { MAX_PHOTOS } from '../components/PortfolioPhotos';
import ShareBookingLink, { bookingUrl } from '../components/ShareBookingLink';

const CLOUDINARY_CLOUD = 'dktit6s95';
const CLOUDINARY_PRESET = 'bookplus';
const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'https://www.bookplus.pro';

// Notice (in hours) a client must give to cancel or reschedule online.
const CANCELLATION_OPTIONS = [
    { value: 0, label: 'Clients can cancel anytime' },
    { value: 2, label: 'At least 2 hours before' },
    { value: 4, label: 'At least 4 hours before' },
    { value: 12, label: 'At least 12 hours before' },
    { value: 24, label: 'At least 24 hours before' },
    { value: 48, label: 'At least 48 hours before' },
    { value: 72, label: 'At least 3 days before' },
];

// Shareable public booking link — same handle the onboarding flow generates.
// Shown here so a provider can grab it again any time.
const BookingLinkCard = ({ user, setUser }) => {
    const toast = useToast();
    const slug = user?.businessProfile?.slug || '';
    const [busy, setBusy] = React.useState(false);
    const url = bookingUrl(slug);

    const generate = async () => {
        setBusy(true);
        try {
            const res = await authService.generateBookingSlug();
            setUser({ ...user, businessProfile: { ...(user.businessProfile || {}), slug: res.data.data.slug } });
        } catch { toast("Couldn't generate your booking link — please try again.", 'error'); } finally { setBusy(false); }
    };

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
            <p style={{ margin: '0 0 0.2rem', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.92rem' }}>Your booking link</p>
            <p style={{ margin: '0 0 0.7rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Each team member also has their own link, on the Team page.</p>
            {slug ? (
                <ShareBookingLink url={url} shareTitle={user?.businessProfile?.businessName || user?.name} />
            ) : (
                <button onClick={generate} disabled={busy} className="btn-primary" style={{ padding: '0.5rem 1.1rem', fontSize: '0.85rem' }}>
                    {busy ? 'Generating…' : 'Get my booking link'}
                </button>
            )}
        </div>
    );
};

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
            <span key={i} style={{ color: i <= rating ? '#f59e0b' : 'var(--border)', fontSize: '1rem' }}>★</span>
        ))}
    </span>
);

// `ownerOnly`: the business's own storefront (its photos and addresses) — the
// owner's alone. A team member's Account is this same page over THEIR profile.
const ALL_SECTIONS = [
    { id: 'profile', label: 'My profile' },
    { id: 'portfolio', label: 'Portfolio', ownerOnly: true },
    { id: 'locations', label: 'Locations', ownerOnly: true },
    { id: 'reviews', label: 'Reviews' },
    { id: 'settings', label: 'Personal settings' },
];

// A team member's own booking link: clients who open it book with them.
const MemberBookingLinkCard = ({ profile, userName }) => {
    const url = bookingUrl(profile?.businessSlug, profile?.linkSlug);
    return (
        <div data-testid="my-booking-link" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)', padding: '1.1rem 1.25rem', marginBottom: '1.5rem' }}>
            <p style={{ margin: '0 0 0.2rem', fontWeight: 600, color: 'var(--charcoal)', fontSize: '0.92rem' }}>Your booking link</p>
            <p style={{ margin: '0 0 0.7rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {url
                    ? 'Clients who open it book with you straight away, for your own services and prices.'
                    : `Your link appears once ${profile?.businessName || 'the business'} creates its booking link.`}
            </p>
            <ShareBookingLink url={url} shareTitle={`Book with ${(profile?.name || userName || 'me').split(' ')[0]}`} testId="my-link" />
        </div>
    );
};

const ProviderAccount = () => {
    const { user, setUser } = useAuthContext();
    const isStaff = user?.role === 'staff';
    const sidebarItems = ALL_SECTIONS.filter((i) => !(isStaff && i.ownerOnly));
    // A member's profile is their roster row (the name, photo and title clients
    // see when choosing who to book), edited through /team/mine/profile.
    const [memberProfile, setMemberProfile] = useState(null);
    const [memberForm, setMemberForm] = useState({ name: '', phone: '', bio: '', languagesText: '' });
    const [memberStats, setMemberStats] = useState(null);
    useEffect(() => {
        if (!isStaff) return;
        myProfileService.get().then((r) => {
            const d = r.data.data || {};
            setMemberProfile(d);
            setMemberForm({ name: d.name || '', phone: d.phone || '', bio: d.bio || '', languagesText: (d.languages || []).join(', ') });
        }).catch(() => setMemberProfile(false));
        myStatsService.get(30).then((r) => setMemberStats(r.data.data)).catch(() => setMemberStats(null));
    }, [isStaff]);
    const navigate = useNavigate();
    const toast = useToast();
    const { darkMode: darkModeOn, toggleDarkMode } = useTheme();
    // ?section=portfolio (etc.) opens that section — the setup nudge links straight to it.
    const location = useLocation();
    const sectionFromUrl = () => {
        const s = new URLSearchParams(location.search).get('section');
        return sidebarItems.some((i) => i.id === s) ? s : 'profile';
    };
    const [section, setSection] = useState(sectionFromUrl);
    useEffect(() => { setSection(sectionFromUrl()); // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

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
    const [profileForm, setProfileForm] = useState({ name: user?.name || '', phone: user?.phone || '', ownerTitle: user?.businessProfile?.ownerTitle || '', address: user?.businessProfile?.address || '', businessName: user?.businessProfile?.businessName || '', description: user?.businessProfile?.description || '', cancellationWindowHours: user?.bookingPolicy?.cancellationWindowHours ?? 0, coordinates: user?.businessProfile?.coordinates?.lat != null ? user.businessProfile.coordinates : null });
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
    // edits: { [photo url]: { crop + adjustments } } — the API stores them as a list.
    const [portfolio, setPortfolio] = useState({ images: [], instagramUrl: '', shape: '1:1', edits: {} });
    const [portfolioLoading, setPortfolioLoading] = useState(false);
    const [portfolioSaving, setPortfolioSaving] = useState(false);
    const portfolioRef = useRef(portfolio); // the latest, for saves that finish after an upload
    portfolioRef.current = portfolio;

    // Reviews
    const [reviews, setReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(null);
    const [reviewsLoading, setReviewsLoading] = useState(false);

    useEffect(() => {
        if (section === 'reviews' && reviews.length === 0) loadReviews();
        if (section === 'portfolio' && portfolio.images.length === 0) loadPortfolio();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section]);

    // Load the review summary on mount so the profile card shows the real rating.
    useEffect(() => {
        loadReviews();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memberProfile?._id]);

    const loadPortfolio = async () => {
        setPortfolioLoading(true);
        try {
            const res = await authService.getProfile();
            const p = res.data.data?.portfolio || {};
            const edits = {};
            (p.edits || []).forEach(({ url, ...e }) => { if (url) edits[url] = e; });
            setPortfolio({ images: p.images || [], instagramUrl: p.instagramUrl || '', shape: p.shape || '1:1', edits });
        } catch { /* ignore */ } finally {
            setPortfolioLoading(false);
        }
    };

    const loadReviews = async () => {
        if (isStaff && !memberProfile?._id) return; // their reviews load once their profile has
        setReviewsLoading(true);
        try {
            // A member's reviews are the ones clients left for a visit with THEM.
            const res = isStaff
                ? await providerMarketService.getProviderStaffReviews(user.staffOf, memberProfile._id)
                : await reviewService.getProviderReviews();
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
            if (isStaff) {
                const res = await myProfileService.update({ photoUrl: url });
                setMemberProfile((p) => ({ ...p, photoUrl: res.data.data?.photoUrl || url }));
                setProfileMsg('Photo updated!');
                return;
            }
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
            if (isStaff) {
                if (!memberForm.name.trim()) { setProfileMsg('Your name can’t be empty — save failed'); return; }
                const languages = memberForm.languagesText.split(',').map((x) => x.trim()).filter(Boolean);
                const res = await myProfileService.update({ name: memberForm.name.trim(), phone: memberForm.phone || '', bio: memberForm.bio || '', languages });
                setMemberProfile((p) => ({ ...p, ...res.data.data }));
                setProfileMsg('Profile saved!');
                return;
            }
            const res = await authService.updateProfile(profileForm);
            setUser(res.data.data);
            setProfileMsg('Profile saved!');
        } catch { setProfileMsg('Save failed — try again'); }
        finally { setProfileSaving(false); }
    };

    // Save the whole portfolio (photos, order, post shape, framing). Shown at once;
    // put back as it was if the server refuses, so the screen never lies.
    const savePortfolio = async (next, okMsg) => {
        const prev = portfolioRef.current;
        setPortfolio(next);
        try {
            await authService.updatePortfolio({
                images: next.images,
                instagramUrl: next.instagramUrl,
                shape: next.shape,
                edits: Object.entries(next.edits || {}).filter(([url]) => next.images.includes(url)).map(([url, e]) => ({ ...e, url })),
            });
            if (okMsg) toast(okMsg, 'success');
            return true;
        } catch {
            setPortfolio(prev);
            toast("Couldn't save your photos — please try again.", 'error');
            return false;
        }
    };

    const handlePortfolioImageAdd = async (files) => {
        const room = MAX_PHOTOS - portfolioRef.current.images.length;
        if (!files.length || room <= 0) return;
        setPortfolioSaving(true);
        try {
            const urls = await Promise.all(files.slice(0, room).map(uploadToCloudinary));
            const latest = portfolioRef.current; // the owner may have reordered or edited meanwhile
            await savePortfolio({ ...latest, images: [...latest.images, ...urls] }, urls.length === 1 ? 'Photo added.' : `${urls.length} photos added.`);
            if (files.length > room) toast(`Only ${MAX_PHOTOS} photos fit — the rest weren't added.`, 'error');
        } catch { toast('Upload failed — please try again.', 'error'); }
        finally { setPortfolioSaving(false); }
    };

    const handleInstagramSave = async () => {
        setPortfolioSaving(true);
        try { await savePortfolio(portfolio, 'Instagram link saved.'); }
        finally { setPortfolioSaving(false); }
    };

    const sideStyle = (id) => ({
        display: 'flex', alignItems: 'center', gap: '0.65rem',
        padding: '0.7rem 1rem', borderRadius: 'var(--radius-sm)',
        cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left',
        background: section === id ? 'rgba(240,62,22,0.1)' : 'transparent',
        color: section === id ? 'var(--gold-dark)' : 'var(--text-secondary)',
        fontWeight: section === id ? '600' : '400',
        fontFamily: 'var(--font-body)', fontSize: '0.9rem',
        transition: 'all 0.15s',
    });

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh', paddingTop: 'calc(56px + 1.5rem)' }}>
            <div className="container" style={{ paddingTop: '0.5rem', paddingBottom: '4.5rem' }}>

                {/* Back to dashboard */}
                <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                    ← Back to Dashboard
                </Link>

                <div className="provider-account-grid" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: '2rem', alignItems: 'start' }}>

                    {/* Sidebar */}
                    <div className="provider-account-sidebar" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 0.75rem', position: 'sticky', top: 'calc(90px + env(safe-area-inset-top, 0px))' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0.5rem', marginBottom: '0.5rem' }}>Your account</p>
                        {sidebarItems.map(item => (
                            <button key={item.id} onClick={() => setSection(item.id)} style={sideStyle(item.id)}>
                                {item.label}
                            </button>
                        ))}
                        {/* Booking as a customer happens on the customer site — hard
                            navigation so it boots fresh with customer data. */}
                        <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
                            <button
                                onClick={() => { window.location.href = import.meta.env.VITE_CUSTOMER_URL || 'http://localhost:3002'; }}
                                style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.75rem', background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: '600', color: 'var(--gold-dark)' }}
                            >
                                ⇄ Open the customer site
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div>

                        {/* ── MY PROFILE ── */}
                        {section === 'profile' && (
                            <div>
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>
                                    My profile
                                    <span style={{ marginLeft: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: '#d1fae5', color: '#065f46', fontSize: '0.72rem', fontWeight: '600', padding: '0.2rem 0.7rem', borderRadius: '99px', verticalAlign: 'middle' }}>
                                        ● Online
                                    </span>
                                </h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Edit and manage the content of your online profile</p>

                                {isStaff ? <MemberBookingLinkCard profile={memberProfile} userName={user?.name} /> : <BookingLinkCard user={user} setUser={setUser} />}

                                <div className="provider-profile-two-col">
                                    {/* Left - photo + name */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '2rem', textAlign: 'center' }}>
                                        <div style={{ width: '90px', height: '90px', borderRadius: '50%', overflow: 'hidden', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', fontSize: '2rem', fontWeight: '600', color: 'var(--ink)' }}>
                                            {(isStaff ? memberProfile?.photoUrl : user?.avatar)
                                                ? <img src={cloudinaryAvatar(isStaff ? memberProfile.photoUrl : user.avatar)} alt={isStaff ? memberProfile?.name : user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                : (isStaff ? (memberProfile?.name || user?.name) : user?.name)?.charAt(0).toUpperCase()
                                            }
                                        </div>
                                        <button onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading} style={{ display: 'block', margin: '0 auto 1.25rem', border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-secondary)', padding: '0.45rem 1.1rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', fontFamily: 'var(--font-body)' }}>
                                            {avatarUploading ? 'Uploading...' : 'Edit photo'}
                                        </button>
                                        <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />

                                        <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>{isStaff ? (memberProfile?.name || user?.name) : user?.name}</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                                            {avgRating ? `★ ${avgRating} · ${reviews.length} review${reviews.length === 1 ? '' : 's'}` : 'No reviews yet'}
                                        </p>
                                        {!isStaff && user?.providerCategory && (
                                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{user.providerCategory}</p>
                                        )}
                                        {isStaff && (
                                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{memberProfile?.role || 'Team member'} · set by your business</p>
                                        )}

                                        {isStaff ? (
                                        <form onSubmit={handleProfileSave} data-testid="member-profile-form" style={{ marginTop: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            {[['Full Name', 'name', 'input'], ['Phone', 'phone', 'input'], ['About you', 'bio', 'textarea'], ['Languages', 'languagesText', 'input']].map(([label, key, kind]) => (
                                                <div key={key}>
                                                    <label htmlFor={`acct-${key}`} style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>{label}</label>
                                                    {kind === 'textarea'
                                                        ? <textarea id={`acct-${key}`} value={memberForm[key]} onChange={e => setMemberForm(f => ({ ...f, [key]: e.target.value.slice(0, 300) }))} className="input" rows={3} placeholder="A line or two clients see when they choose who to book." style={{ resize: 'vertical' }} />
                                                        : <input id={`acct-${key}`} value={memberForm[key]} onChange={e => setMemberForm(f => ({ ...f, [key]: e.target.value }))} className="input" placeholder={key === 'languagesText' ? 'e.g. English, Oshiwambo' : undefined} />}
                                                </div>
                                            ))}
                                            {profileMsg && <p style={{ fontSize: '0.8rem', color: profileMsg.includes('fail') ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{profileMsg}</p>}
                                            <button type="submit" disabled={profileSaving || !memberProfile} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                                {profileSaving ? 'Saving...' : 'Save changes'}
                                            </button>
                                        </form>
                                        ) : (
                                        <form onSubmit={handleProfileSave} style={{ marginTop: '1.5rem', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                            <div>
                                                <Field label="Business name" labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                    <input value={profileForm.businessName} onChange={e => setProfileForm(p => ({ ...p, businessName: e.target.value }))} className="input" placeholder="Your business name" />
                                                </Field>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>This is the name customers see in search and on your card.</p>
                                            </div>
                                            <div>
                                                <Field label="Description" labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                    <textarea value={profileForm.description} onChange={e => setProfileForm(p => ({ ...p, description: e.target.value.slice(0, 160) }))} className="input" rows={2} placeholder="One line about your business — what you do best." style={{ resize: 'vertical' }} />
                                                </Field>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>Shown on your card and profile. {160 - (profileForm.description?.length || 0)} characters left.</p>
                                            </div>
                                            <div>
                                                <Field label="Full Name" labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                    <input value={profileForm.name} onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))} className="input" />
                                                </Field>
                                            </div>
                                            <div>
                                                <Field label="Job title" labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                    <input value={profileForm.ownerTitle} onChange={e => setProfileForm(p => ({ ...p, ownerTitle: e.target.value.slice(0, 60) }))} className="input" placeholder="e.g. Therapist, Trainer, Consultant, Technician" />
                                                </Field>
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>How you appear to clients when they pick a professional. Leave blank to show “Owner”.</p>
                                            </div>
                                            <div>
                                                <Field label="Phone" labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                    <input value={profileForm.phone} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} className="input" />
                                                </Field>
                                            </div>
                                            <div>
                                                <label htmlFor="business-address" style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Business Address</label>
                                                {MAPS_KEY && (
                                                    <div style={{ marginBottom: '0.6rem' }}>
                                                        <MapPicker
                                                            coordinates={profileForm.coordinates}
                                                            height={200}
                                                            onPick={async (c) => {
                                                                setProfileForm(p => ({ ...p, coordinates: c }));
                                                                const a = await reverseGeocode(c.lat, c.lng);
                                                                if (a) setProfileForm(p => ({ ...p, address: a }));
                                                            }}
                                                        />
                                                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>Tap the map or drag the pin to set your exact location.</p>
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={handleDetectLocation}
                                                    disabled={geoLoading}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.35rem 0.75rem', marginBottom: '0.5rem', border: '1px solid var(--gold)', borderRadius: 'var(--radius-sm)', background: 'rgba(240,62,22,0.08)', color: 'var(--gold-dark)', fontSize: '0.75rem', fontWeight: '600', cursor: geoLoading ? 'not-allowed' : 'pointer', opacity: geoLoading ? 0.7 : 1 }}
                                                >
                                                    {geoLoading ? <span style={{ display: 'inline-block', width: '11px', height: '11px', border: '2px solid rgba(240,62,22,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>}
                                                    {geoLoading ? 'Detecting…' : 'Use current location'}
                                                </button>
                                                <textarea id="business-address" value={profileForm.address} onChange={e => setProfileForm(p => ({ ...p, address: e.target.value }))} className="input" rows={2} placeholder="e.g. 12 Independence Ave, Windhoek" style={{ resize: 'vertical', fontSize: '1rem' }} />
                                            </div>
                                            <div>
                                                <label htmlFor="cancellation-policy" id="cancellation-policy-label" style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>Cancellation policy</label>
                                                <Select id="cancellation-policy"
                                                    value={profileForm.cancellationWindowHours}
                                                    onChange={e => setProfileForm(p => ({ ...p, cancellationWindowHours: Number(e.target.value) }))}
                                                    options={CANCELLATION_OPTIONS}
                                                    aria-labelledby="cancellation-policy-label"
                                                    sheetTitle="Cancellation policy"
                                                    data-testid="cancellation-policy"
                                                />
                                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.3rem 0 0' }}>How much notice clients must give to cancel or reschedule online. You can always cancel from your side.</p>
                                            </div>
                                            {profileMsg && <p style={{ fontSize: '0.8rem', color: profileMsg.includes('fail') ? 'var(--danger-fg)' : 'var(--success-fg)' }}>{profileMsg}</p>}
                                            <button type="submit" disabled={profileSaving} className="btn-primary" style={{ padding: '0.65rem 1.5rem', fontSize: '0.875rem' }}>
                                                {profileSaving ? 'Saving...' : 'Save changes'}
                                            </button>
                                        </form>
                                        )}
                                    </div>

                                    {/* Right - info cards */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Account details</h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Email</span>
                                                    <span className="acct-value">{user?.email}</span>
                                                </div>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Phone</span>
                                                    <span className="acct-value">{user?.phone}</span>
                                                </div>
                                                {isStaff ? (
                                                    <>
                                                        <div className="acct-detail-row">
                                                            <span className="acct-label">Business</span>
                                                            <span className="acct-value">{memberProfile?.businessName || '—'}</span>
                                                        </div>
                                                        <div className="acct-detail-row">
                                                            <span className="acct-label">Job title</span>
                                                            <span className="acct-value">{memberProfile?.role || '—'}</span>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Category</span>
                                                    <span className="acct-value">{user?.providerCategory || '—'}</span>
                                                </div>
                                                <div className="acct-detail-row">
                                                    <span className="acct-label">Verified</span>
                                                    <span className="acct-value" style={{ color: user?.isVerified ? 'var(--success-fg)' : 'var(--warning-fg)', fontWeight: '600' }}>{user?.isVerified ? 'Verified' : 'Pending'}</span>
                                                </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {isStaff ? (
                                            <div data-testid="member-stats" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Last 30 days</h3>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.75rem' }}>
                                                    {[['Completed', memberStats?.appointments ?? '—'], ['Coming up', memberStats?.upcoming ?? '—'], ['Rating', memberStats?.rating != null ? `${memberStats.rating} ★` : '—']].map(([l, v]) => (
                                                        <div key={l} style={{ padding: '0.8rem', borderRadius: 'var(--radius-sm)', background: 'var(--surface-sunken)' }}>
                                                            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
                                                            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700, color: 'var(--charcoal)' }}>{v}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>Online profile visibility</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Your profile is visible to clients searching for businesses on Bookplus.</p>
                                            {/* Public profiles live on the customer app — plain anchor, not a router Link. */}
                                            <a href={`${CUSTOMER_URL}/providers/${user?.id}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)', fontWeight: '600', textDecoration: 'none', fontSize: '0.875rem' }}>View public profile →</a>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── PORTFOLIO ── */}
                        {section === 'portfolio' && (
                            <div>
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Portfolio</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>These photos are your post on the Bookplus feed — pick its shape, then frame each one.</p>

                                {portfolioLoading ? (
                                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                                ) : (
                                    <>
                                        <PortfolioPhotos portfolio={portfolio} onSave={savePortfolio} onAddFiles={handlePortfolioImageAdd} uploading={portfolioSaving} />

                                        {/* Instagram link */}
                                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                            <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>📷 Instagram feed</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Link your Instagram profile to showcase your latest work automatically.</p>
                                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                <input aria-label="Instagram profile URL"
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
                        {section === 'locations' && <LocationsManager />}

                        {section === 'reviews' && (
                            <div>
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Reviews</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Star ratings and reviews left by clients after their visit</p>

                                {reviewsLoading ? (
                                    <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
                                ) : reviews.length === 0 ? (
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '5rem 2rem', textAlign: 'center' }}>
                                        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⭐</div>
                                        <p style={{ fontFamily: 'var(--font-body)', fontSize: '1.1rem', color: 'var(--charcoal)', marginBottom: '0.4rem', fontWeight: '600' }}>No reviews yet</p>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Clients have not provided feedback for their appointments yet.</p>
                                    </div>
                                ) : (
                                    <>
                                        {avgRating && (
                                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <span style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: '600', color: 'var(--charcoal)', lineHeight: 1 }}>{avgRating}</span>
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
                                                            <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '600', fontSize: '0.8rem', color: 'var(--ink)', flexShrink: 0, overflow: 'hidden' }}>
                                                                {r.customer?.avatar
                                                                    ? <img src={cloudinaryAvatar(r.customer.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
                                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>Personal settings</h1>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '2rem' }}>Manage settings for your personal account</p>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                                    {/* Personal info */}
                                    <div onClick={() => setSection('profile')} style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', cursor: 'pointer', transition: 'box-shadow 0.2s', display: 'flex', alignItems: 'center', gap: '1.25rem' }}
                                        onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-md)'}
                                        onMouseLeave={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                                    >
                                        <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>👤</div>
                                        <div style={{ flex: 1 }}>
                                            <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Personal info</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Customise your personal details and how we can contact you</p>
                                        </div>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '1.2rem' }}>›</span>
                                    </div>

                                    {/* Login & security */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: `1px solid ${settingsOpen === 'security' ? 'var(--gold)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div onClick={() => setSettingsOpen(s => s === 'security' ? null : 'security')} style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>🔐</div>
                                            <div style={{ flex: 1 }}>
                                                <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Login &amp; security</h3>
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
                                                            <Field label={label} labelStyle={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.3rem' }}>
                                                                <input type="password" className="input" value={pwForm[key]} onChange={e => setPwForm(f => ({ ...f, [key]: e.target.value }))} />
                                                            </Field>
                                                        </div>
                                                    ))}
                                                    {pwMsg.text && <p style={{ fontSize: '0.8rem', color: pwMsg.ok ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{pwMsg.text}</p>}
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
                                                <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Appearance</h3>
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
                                                            background: darkModeOn ? 'var(--gold)' : 'var(--warm-gray)',
                                                            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                                                        }}
                                                    >
                                                        <span style={{ position: 'absolute', top: '3px', left: '3px', width: '22px', height: '22px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transform: darkModeOn ? 'translateX(24px)' : 'translateX(0)', transition: 'transform 0.2s' }} />
                                                    </button>
                                                </div>
                                                <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
                                                    <PushToggle />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Calendar */}
                                    {!isStaff && <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: `1px solid ${settingsOpen === 'calendar' ? 'var(--gold)' : 'var(--border)'}`, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div onClick={() => setSettingsOpen(s => s === 'calendar' ? null : 'calendar')} style={{ padding: '1.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>📅</div>
                                            <div style={{ flex: 1 }}>
                                                <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Google Calendar</h3>
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
                                                    <input aria-label="Google Calendar embed URL"
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
                                                {calendarEmbedMsg && <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: calendarEmbedMsg === 'Saved!' ? 'var(--success-fg)' : 'var(--danger-fg)' }}>{calendarEmbedMsg}</p>}
                                                {calendarEmbed && <p style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>✓ Google Calendar is connected. Switch to the Google view in your Dashboard → Calendar tab.</p>}
                                            </div>
                                        )}
                                    </div>}

                                    {/* Legal — the Terms & Privacy that govern your business account,
                                        surfaced here so they're reachable in-app, not only at signup. */}
                                    <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
                                        <div style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                                            <div style={{ fontSize: '1.6rem', flexShrink: 0 }}>📄</div>
                                            <div style={{ flex: 1, minWidth: '160px' }}>
                                                <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.2rem' }}>Legal</h3>
                                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>The Terms of Service and Privacy Policy for your business account.</p>
                                            </div>
                                            <div style={{ display: 'flex', gap: '1.25rem', flexShrink: 0 }}>
                                                <Link to="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Terms of Service →</Link>
                                                <Link to="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none' }}>Privacy Policy →</Link>
                                                <button type="button" onClick={openConsentSettings} data-testid="cookie-settings-link" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}>Cookie settings →</button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Closing the business's account is the owner's; a member's login is managed by the owner. */}
                                    <YourDataCard note={isStaff ? 'To delete your login, ask the business owner to remove you from the team.' : undefined} />
                                    {!isStaff && <AccountDangerZone />}
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
