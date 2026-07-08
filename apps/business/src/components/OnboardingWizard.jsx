import React, { useEffect, useMemo, useState } from 'react';
import { GoogleMap, Marker, useJsApiLoader } from '@react-google-maps/api';
import { authService, availabilityService, providerServiceService } from '../services';
import { uploadToCloudinary } from '../utils/uploadImage';
import { cloudinaryAvatar, cloudinaryThumb } from '../utils/cloudinary';
import { MapPin, Clock, Scissors, Camera, LinkIcon, Check, Copy, Share2, ArrowLeft, Crosshair, Plus, X } from 'lucide-react';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const CUSTOMER_URL = import.meta.env.VITE_CUSTOMER_URL || 'https://www.bookplus.pro';

// Windhoek — a sensible default centre for a Namibian marketplace until the
// provider drops their own pin.
const DEFAULT_CENTER = { lat: -22.5609, lng: 17.0658 };

const DAYS = [
    ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'],
    ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday'],
];

const defaultSchedule = () => {
    const s = {};
    DAYS.forEach(([k], i) => {
        s[k] = { enabled: i < 5, slots: [{ start: '09:00', end: '17:00' }] };
    });
    return s;
};

// Turn coordinates into a readable address (free OSM reverse-geocode — no
// Google Geocoding bill). Best-effort; a failure just leaves the field as-is.
const reverseGeocode = async (lat, lng) => {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
        );
        const d = await res.json();
        const a = d.address || {};
        return [a.road || a.pedestrian, a.house_number, a.suburb || a.neighbourhood,
            a.city || a.town || a.village, a.state, a.country].filter(Boolean).join(', ');
    } catch {
        return '';
    }
};

// Draggable Google-Maps pin. Isolated so its useJsApiLoader hook only runs when
// a key is configured (the parent renders the text fallback otherwise).
const MapPicker = ({ coordinates, onPick }) => {
    const { isLoaded, loadError } = useJsApiLoader({ id: 'gmaps', googleMapsApiKey: MAPS_KEY });
    const center = coordinates && coordinates.lat != null ? coordinates : DEFAULT_CENTER;

    const locate = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => onPick({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            () => {},
            { timeout: 8000 }
        );
    };

    if (loadError) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Map couldn’t load — you can still type your address below.</p>;
    if (!isLoaded) return <div style={{ height: 240, borderRadius: 'var(--radius)', background: 'var(--surface-sunken)' }} />;

    return (
        <div style={{ position: 'relative' }}>
            <GoogleMap
                mapContainerStyle={{ width: '100%', height: 240, borderRadius: 'var(--radius)' }}
                center={center}
                zoom={coordinates && coordinates.lat != null ? 16 : 12}
                options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
                onClick={(e) => onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
            >
                {coordinates && coordinates.lat != null && (
                    <Marker
                        position={coordinates}
                        draggable
                        onDragEnd={(e) => onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
                    />
                )}
            </GoogleMap>
            <button
                type="button"
                onClick={locate}
                style={{ position: 'absolute', top: 10, right: 10, display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.75rem', borderRadius: '999px', border: 'none', background: 'var(--card-bg)', color: 'var(--charcoal)', boxShadow: '0 2px 8px rgba(0,0,0,0.18)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'var(--font-body)' }}
            >
                <Crosshair size={14} /> My location
            </button>
        </div>
    );
};

const StepHeading = ({ Icon, title, sub }) => (
    <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ width: '52px', height: '52px', borderRadius: '14px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
            <Icon size={26} strokeWidth={2} />
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem, 5vw, 2.2rem)', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '0.5rem', lineHeight: 1.1 }}>{title}</h1>
        {sub && <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>{sub}</p>}
    </div>
);

const OnboardingWizard = ({ user, onComplete }) => {
    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Step data
    const [businessName, setBusinessName] = useState(user?.businessProfile?.businessName || user?.name || '');
    const [address, setAddress] = useState(user?.businessProfile?.address || '');
    const [coordinates, setCoordinates] = useState(
        user?.businessProfile?.coordinates?.lat != null ? user.businessProfile.coordinates : null
    );
    const [schedule, setSchedule] = useState(defaultSchedule());
    const [services, setServices] = useState([{ name: '', duration: 30, price: '' }]);
    const [createdCount, setCreatedCount] = useState(0);
    const [avatarUrl, setAvatarUrl] = useState(user?.avatar || '');
    const [postImages, setPostImages] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [slug, setSlug] = useState(user?.businessProfile?.slug || '');
    const [copied, setCopied] = useState(false);

    const STEPS = useMemo(() => ([
        { id: 'welcome', Icon: Check },
        { id: 'address', Icon: MapPin, title: 'Where are you located?', sub: 'Drop a pin so clients can find you and get directions.' },
        { id: 'hours', Icon: Clock, title: 'Your working hours', sub: 'When can clients book with you?' },
        { id: 'services', Icon: Scissors, title: 'What do you offer?', sub: 'Add your services and how long each takes — we build your booking times from this.' },
        { id: 'photos', Icon: Camera, title: 'Show off your work', sub: 'Add a profile photo and at least one photo of your work.' },
        { id: 'link', Icon: LinkIcon, title: 'Your booking link is ready', sub: 'Share this link so clients can book you directly.' },
    ]), []);
    const total = STEPS.length;
    const current = STEPS[step];
    const progress = Math.round((step / (total - 1)) * 100);
    const skippable = ['address', 'hours', 'services', 'photos'].includes(current.id);

    // Seed the hours editor from any saved availability.
    useEffect(() => {
        availabilityService.getMyAvailability()
            .then((r) => { if (r?.data?.data?.schedule) setSchedule((prev) => ({ ...prev, ...r.data.data.schedule })); })
            .catch(() => {});
    }, []);

    // Mint the booking-link slug the moment the provider reaches the final step.
    useEffect(() => {
        if (current.id === 'link' && !slug) {
            authService.generateBookingSlug()
                .then((r) => setSlug(r.data.data.slug))
                .catch(() => {});
        }
    }, [current.id, slug]);

    const goNext = () => setStep((s) => Math.min(s + 1, total - 1));
    const goBack = () => setStep((s) => Math.max(s - 1, 0));

    // Persist the current step, then advance. Skip calls goNext() directly.
    const saveAndNext = async () => {
        setSaving(true);
        setError('');
        try {
            if (current.id === 'welcome') {
                if (businessName.trim()) await authService.updateProfile({ businessName: businessName.trim() });
            } else if (current.id === 'address') {
                await authService.updateProfile({ address: address.trim(), coordinates: coordinates || null });
            } else if (current.id === 'hours') {
                await availabilityService.updateMyAvailability(schedule);
            } else if (current.id === 'services') {
                // Create only the not-yet-saved rows that are filled in.
                const fresh = services.slice(createdCount).filter((s) => s.name.trim() && Number(s.duration) > 0);
                for (const s of fresh) {
                    await providerServiceService.createMyService({
                        name: s.name.trim(),
                        // Service model requires a description; seed it from the
                        // name — the provider can enrich it later in the Catalogue.
                        description: s.name.trim(),
                        duration: Number(s.duration),
                        price: Number(s.price) || 0,
                    });
                }
                setCreatedCount(services.length);
            } else if (current.id === 'photos') {
                if (avatarUrl && avatarUrl !== user?.avatar) await authService.updateProfile({ avatar: avatarUrl });
                if (postImages.length) await authService.updatePortfolio({ images: postImages });
            }
            goNext();
        } catch (err) {
            setError(err?.response?.data?.message || 'Could not save — please try again.');
        } finally {
            setSaving(false);
        }
    };

    const finish = async () => {
        setSaving(true);
        try {
            // Flips providerSetupComplete and returns the fresh user. We pass the
            // address we already saved so this call doesn't blank it.
            const res = await authService.completeProviderSetup({ businessName: businessName.trim(), address: address.trim() });
            onComplete(res.data.data);
        } catch {
            onComplete({ ...user, providerSetupComplete: true });
        } finally {
            setSaving(false);
        }
    };

    const onAvatarPick = async (file) => {
        if (!file) return;
        setUploading(true);
        try { setAvatarUrl(await uploadToCloudinary(file)); } catch { setError('Photo upload failed.'); } finally { setUploading(false); }
    };
    const onPostsPick = async (files) => {
        const list = Array.from(files || []).slice(0, 5 - postImages.length);
        if (!list.length) return;
        setUploading(true);
        try {
            const urls = await Promise.all(list.map(uploadToCloudinary));
            setPostImages((p) => [...p, ...urls].slice(0, 5));
        } catch { setError('Photo upload failed.'); } finally { setUploading(false); }
    };

    const bookingUrl = slug ? `${CUSTOMER_URL}/b/${slug}` : '';
    const copyLink = async () => {
        try { await navigator.clipboard.writeText(bookingUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* ignore */ }
    };
    const shareLink = async () => {
        if (navigator.share) { try { await navigator.share({ title: businessName || 'Book with me', url: bookingUrl }); } catch { /* cancelled */ } }
        else copyLink();
    };

    const photosReady = !!avatarUrl && postImages.length >= 1;
    const primaryDisabled = saving || uploading || (current.id === 'photos' && !photosReady);

    const darkBtn = { width: '100%', padding: '0.95rem', borderRadius: '999px', border: 'none', background: 'var(--ink, #040505)', color: '#fff', fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--off-white)', display: 'flex', flexDirection: 'column' }}>
            {/* Progress bar */}
            <div style={{ height: '4px', background: 'var(--border)', flexShrink: 0 }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gold)', transition: 'width 0.4s ease' }} />
            </div>

            {/* Header: back + step + skip */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', flexShrink: 0 }}>
                <button type="button" onClick={goBack} disabled={step === 0} aria-label="Back"
                    style={{ background: 'none', border: 'none', cursor: step === 0 ? 'default' : 'pointer', color: step === 0 ? 'transparent' : 'var(--charcoal)', padding: '0.4rem', display: 'flex' }}>
                    <ArrowLeft size={22} />
                </button>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                    {step === 0 ? '' : `Step ${step} of ${total - 2}`}
                </span>
                {skippable ? (
                    <button type="button" onClick={goNext} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 600, fontFamily: 'var(--font-body)', padding: '0.4rem' }}>
                        Skip
                    </button>
                ) : <span style={{ width: 44 }} />}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.25rem 2rem' }}>
                <div style={{ maxWidth: '520px', margin: '0 auto' }}>

                    {current.id === 'welcome' && (
                        <div style={{ paddingTop: '1.5rem' }}>
                            <div style={{ width: '60px', height: '60px', borderRadius: '16px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.25rem' }}>
                                <Scissors size={30} strokeWidth={2} />
                            </div>
                            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.9rem, 6vw, 2.5rem)', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '0.6rem', lineHeight: 1.1 }}>
                                Let’s set up your business
                            </h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: 1.65, marginBottom: '1.75rem' }}>
                                A few quick steps so clients can find and book you. You can skip any step and finish it later from Settings.
                            </p>
                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Business name</label>
                            <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. The Vibe Barbershop" style={{ fontSize: '1rem' }} />
                            <ul style={{ listStyle: 'none', padding: 0, margin: '1.75rem 0 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {['Set your location & hours', 'Add your services and prices', 'Get a shareable booking link'].map((t) => (
                                    <li key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                                        <Check size={18} style={{ color: 'var(--gold)', flexShrink: 0 }} /> {t}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {current.id === 'address' && (
                        <div>
                            <StepHeading Icon={current.Icon} title={current.title} sub={current.sub} />
                            {MAPS_KEY
                                ? <MapPicker coordinates={coordinates} onPick={async (c) => { setCoordinates(c); const a = await reverseGeocode(c.lat, c.lng); if (a) setAddress(a); }} />
                                : (
                                    <div style={{ padding: '1rem 1.25rem', background: 'rgba(240,62,22,0.06)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        Map isn’t configured — just type your address below.
                                    </div>
                                )}
                            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', margin: '1.25rem 0 0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Business address</label>
                            <textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 Sam Nujoma Dr, Swakopmund" style={{ fontSize: '0.95rem', resize: 'vertical' }} />
                        </div>
                    )}

                    {current.id === 'hours' && (
                        <div>
                            <StepHeading Icon={current.Icon} title={current.title} sub={current.sub} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {DAYS.map(([key, label]) => {
                                    const day = schedule[key] || { enabled: false, slots: [{ start: '09:00', end: '17:00' }] };
                                    const slot = day.slots?.[0] || { start: '09:00', end: '17:00' };
                                    const setDay = (patch) => setSchedule((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
                                    const setTime = (field, value) => setSchedule((prev) => ({ ...prev, [key]: { ...prev[key], slots: [{ ...slot, [field]: value }] } }));
                                    return (
                                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0.75rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                                            <button type="button" onClick={() => setDay({ enabled: !day.enabled })}
                                                aria-label={`Toggle ${label}`}
                                                style={{ width: '42px', height: '24px', borderRadius: '999px', border: 'none', cursor: 'pointer', background: day.enabled ? 'var(--gold)' : '#d1d5db', position: 'relative', flexShrink: 0 }}>
                                                <span style={{ position: 'absolute', top: '3px', left: day.enabled ? '21px' : '3px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.18s' }} />
                                            </button>
                                            <span style={{ width: '96px', fontSize: '0.88rem', fontWeight: 600, color: day.enabled ? 'var(--charcoal)' : 'var(--text-muted)' }}>{label}</span>
                                            {day.enabled ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                                                    <input type="time" value={slot.start} onChange={(e) => setTime('start', e.target.value)} className="input" style={{ padding: '0.3rem 0.4rem', width: 'auto' }} />
                                                    <span style={{ color: 'var(--text-muted)' }}>–</span>
                                                    <input type="time" value={slot.end} onChange={(e) => setTime('end', e.target.value)} className="input" style={{ padding: '0.3rem 0.4rem', width: 'auto' }} />
                                                </div>
                                            ) : <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Closed</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {current.id === 'services' && (
                        <div>
                            <StepHeading Icon={current.Icon} title={current.title} sub={current.sub} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {services.map((s, i) => {
                                    const setRow = (patch) => setServices((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
                                    const locked = i < createdCount;
                                    return (
                                        <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', opacity: locked ? 0.6 : 1 }}>
                                            <input className="input" disabled={locked} value={s.name} onChange={(e) => setRow({ name: e.target.value })} placeholder="Service (e.g. Haircut)" style={{ flex: 2 }} />
                                            <input className="input" disabled={locked} type="number" min="5" step="5" value={s.duration} onChange={(e) => setRow({ duration: e.target.value })} placeholder="min" style={{ flex: 1, minWidth: 0 }} title="Duration in minutes" />
                                            <input className="input" disabled={locked} type="number" min="0" value={s.price} onChange={(e) => setRow({ price: e.target.value })} placeholder="Price" style={{ flex: 1, minWidth: 0 }} />
                                            {services.length > 1 && !locked && (
                                                <button type="button" onClick={() => setServices((prev) => prev.filter((_, idx) => idx !== i))} aria-label="Remove" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.3rem', flexShrink: 0 }}><X size={18} /></button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            <button type="button" onClick={() => setServices((p) => [...p, { name: '', duration: 30, price: '' }])}
                                style={{ marginTop: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: '1.5px dashed var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 1rem', cursor: 'pointer', color: 'var(--gold-dark)', fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.88rem' }}>
                                <Plus size={16} /> Add another service
                            </button>
                        </div>
                    )}

                    {current.id === 'photos' && (
                        <div>
                            <StepHeading Icon={current.Icon} title={current.title} sub={current.sub} />
                            {/* Profile photo */}
                            <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Profile photo</p>
                            <label style={{ display: 'inline-flex', cursor: 'pointer', marginBottom: '1.5rem' }}>
                                <input type="file" accept="image/*" hidden onChange={(e) => onAvatarPick(e.target.files?.[0])} />
                                <span style={{ width: '96px', height: '96px', borderRadius: '50%', overflow: 'hidden', background: 'var(--surface-sunken)', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                                    {avatarUrl ? <img src={cloudinaryAvatar(avatarUrl, 200)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Camera size={26} />}
                                </span>
                            </label>
                            {/* Work photos */}
                            <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>Your work <span style={{ textTransform: 'none', color: 'var(--text-muted)', fontWeight: 400 }}>(at least 1, up to 5)</span></p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '0.6rem' }}>
                                {postImages.map((img, i) => (
                                    <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                        <img src={cloudinaryThumb(img, 200)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        <button type="button" onClick={() => setPostImages((p) => p.filter((_, idx) => idx !== i))} aria-label="Remove photo" style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(4,5,5,0.65)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={13} /></button>
                                    </div>
                                ))}
                                {postImages.length < 5 && (
                                    <label style={{ aspectRatio: '1', borderRadius: 'var(--radius-sm)', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                        <input type="file" accept="image/*" multiple hidden onChange={(e) => onPostsPick(e.target.files)} />
                                        <Plus size={22} />
                                    </label>
                                )}
                            </div>
                            {uploading && <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--gold-dark)' }}>Uploading…</p>}
                        </div>
                    )}

                    {current.id === 'link' && (
                        <div style={{ textAlign: 'center', paddingTop: '1rem' }}>
                            <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(34,197,94,0.14)', color: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem' }}>
                                <Check size={34} strokeWidth={2.5} />
                            </div>
                            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem, 5vw, 2.2rem)', fontWeight: 700, color: 'var(--charcoal)', marginBottom: '0.5rem' }}>Your link is ready</h1>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
                                Share this link so clients open your profile and book you directly.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.85rem 1rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                                <span style={{ flex: 1, textAlign: 'left', fontSize: '0.9rem', color: 'var(--charcoal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bookingUrl || 'Generating…'}</span>
                                <button type="button" onClick={copyLink} disabled={!slug} aria-label="Copy link" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#16a34a' : 'var(--gold-dark)', display: 'flex', flexShrink: 0 }}>
                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                </button>
                            </div>
                            <button type="button" onClick={shareLink} disabled={!slug} style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem', borderRadius: '999px', border: '1.5px solid var(--border)', background: 'var(--card-bg)', color: 'var(--charcoal)', fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.92rem', cursor: 'pointer' }}>
                                <Share2 size={16} /> Share link
                            </button>
                        </div>
                    )}

                    {error && <p role="alert" style={{ marginTop: '1rem', color: 'var(--danger-fg, #dc2626)', fontSize: '0.85rem' }}>{error}</p>}
                </div>
            </div>

            {/* Footer CTA */}
            <div style={{ flexShrink: 0, padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid var(--border)', background: 'var(--off-white)' }}>
                <div style={{ maxWidth: '520px', margin: '0 auto' }}>
                    {current.id === 'link' ? (
                        <button type="button" onClick={finish} disabled={saving} style={darkBtn}>
                            {saving ? 'Finishing…' : 'Go to dashboard'}
                        </button>
                    ) : (
                        <button type="button" onClick={saveAndNext} disabled={primaryDisabled} style={{ ...darkBtn, opacity: primaryDisabled ? 0.5 : 1 }}>
                            {saving ? 'Saving…' : current.id === 'welcome' ? 'Get started' : 'Continue'}
                        </button>
                    )}
                    {current.id === 'photos' && !photosReady && (
                        <p style={{ textAlign: 'center', marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>Add a profile photo and one work photo, or Skip for now.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default OnboardingWizard;
