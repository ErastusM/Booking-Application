import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { providerMarketService, availabilityService, authService, favoriteService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { cloudinaryAvatar, cloudinaryThumb } from '../utils/cloudinary';
import { currencySymbol } from '../utils/currency';
import { mapsUrl } from '../utils/maps';
import WalletTopUpModal from '../components/WalletTopUpModal';
import { Phone, MessageCircle, Mail, MapPin, ChevronLeft, ChevronRight, X, Share2, Star, Heart, Clock, MoreHorizontal } from 'lucide-react';
import { normalizeTown } from '../utils/namibiaTowns';

// Circular translucent control that floats over the hero photo (back / share / like / ⋯).
// The circle stays white in both themes, so the icon uses --ink (never flips)
// rather than --charcoal (goes light in dark mode → white-on-white).
const floatBtn = { pointerEvents: 'auto', width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.92)', border: 'none', color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.25)', flexShrink: 0 };

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : 'var(--border)', fontSize: '0.9rem' }}>★</span>
        ))}
    </div>
);

const contactRowStyle = { display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '500' };
const contactIconStyle = { width: '28px', height: '28px', borderRadius: '8px', background: 'var(--surface-sunken)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const lightboxBtnStyle = (pos) => ({ position: 'absolute', ...pos, top: pos.top || '50%', transform: pos.top ? 'none' : 'translateY(-50%)', width: '44px', height: '44px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' });

const ProviderProfilePage = ({ providerId } = {}) => {
    const params = useParams();
    // When rendered from the /b/:slug route a resolved id is passed as a prop;
    // the normal /providers/:id route reads it from the URL.
    const id = providerId || params.id;
    const navigate = useNavigate();
    const { user } = useAuthContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('featured');
    const [schedule, setSchedule] = useState(null);
    const [blocked, setBlocked] = useState(false);
    const [showTopUp, setShowTopUp] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [lightbox, setLightbox] = useState(-1); // index of the full-screen photo, -1 = closed
    const [activeSection, setActiveSection] = useState('');
    const [heroIdx, setHeroIdx] = useState(0); // active hero-carousel photo (for the 1/N counter)
    const [isFav, setIsFav] = useState(false);
    const [aboutExpanded, setAboutExpanded] = useState(false);
    const [aboutClamped, setAboutClamped] = useState(false); // 4-line clamp actually truncates
    const aboutRef = useRef(null);
    const [staff, setStaff] = useState([]);
    // Fresha behavior: the compact top bar (back + name + tabs) exists only once
    // the visitor scrolls past the header block; before that the hero owns the top.
    const [showCompact, setShowCompact] = useState(false);
    const headerRef = useRef(null);

    // Load whether this business is saved (for the floating heart).
    useEffect(() => {
        if (!user) { setIsFav(false); return; }
        favoriteService.list()
            .then((r) => setIsFav((r.data.data || []).map(String).includes(String(id))))
            .catch(() => {});
    }, [id, user]);

    const toggleFav = async () => {
        if (!user) { navigate('/login'); return; }
        setIsFav((f) => !f);
        try {
            const r = await favoriteService.toggle(id);
            setIsFav((r.data.data || []).map(String).includes(String(id)));
        } catch { setIsFav((f) => !f); }
    };

    const handleShare = async () => {
        const url = window.location.href;
        if (navigator.share) { try { await navigator.share({ title: document.title || 'Bookplus', url }); } catch { /* cancelled */ } }
        else { try { await navigator.clipboard.writeText(url); } catch { /* ignore */ } }
    };

    // Smooth-jump to a section from the sticky tab nav (scroll-margin on the target
    // clears the fixed app navbar + this sticky bar).
    const scrollToSection = (secId) => {
        setActiveSection(secId);
        // scrollIntoView finds the real scroll container and honours the section's
        // scroll-margin-top (which clears the app navbar + this sticky tab bar).
        document.getElementById(secId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    useEffect(() => {
        if (!user) return;
        authService.getBlockedUsers()
            .then((r) => setBlocked((r.data.data || []).some((u) => u._id === id)))
            .catch(() => {});
    }, [id, user]);

    const toggleBlock = async () => {
        try {
            if (blocked) { await authService.unblockUser(id); setBlocked(false); }
            else if (window.confirm('Block this business? You won’t be able to book or message each other.')) {
                await authService.blockUser(id); setBlocked(true);
            }
        } catch { /* ignore */ }
    };

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await providerMarketService.getProviderProfile(id);
                setData(res.data.data);
            } catch {
                navigate('/');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [id]);

    useEffect(() => {
        availabilityService.getProviderAvailability(id)
            .then(res => setSchedule(res.data.data.schedule))
            .catch(() => {});
    }, [id]);

    // Team members (public endpoint) — powers the Fresha-style Team section.
    // The stale flag stops an out-of-order response from painting provider A's
    // team on provider B's page when navigating between profiles.
    useEffect(() => {
        let stale = false;
        providerMarketService.getProviderStaff(id)
            .then(res => { if (!stale) setStaff(res.data.data || []); })
            .catch(() => { if (!stale) setStaff([]); });
        return () => { stale = true; };
    }, [id]);

    // Show the compact header once the business name scrolls out above the
    // viewport (a scroll listener, not an IntersectionObserver: one rect read
    // per scroll frame is cheap and it can never miss the crossing).
    useEffect(() => {
        if (!data) return;
        const onScroll = () => {
            const el = headerRef.current;
            if (!el) return;
            setShowCompact(el.getBoundingClientRect().bottom < 0);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, [data]);

    // Record the visit for the home page's "Recently viewed" row (newest first).
    useEffect(() => {
        if (!id) return;
        try {
            const key = 'bp_recent_providers';
            const ids = JSON.parse(localStorage.getItem(key) || '[]').filter(x => x !== id);
            ids.unshift(id);
            localStorage.setItem(key, JSON.stringify(ids.slice(0, 12)));
        } catch { /* storage disabled — non-fatal */ }
    }, [id]);

    // Keyboard control for the full-screen photo gallery
    useEffect(() => {
        if (lightbox < 0) return;
        const total = data?.provider?.photos?.length || 0;
        const onKey = (e) => {
            if (e.key === 'Escape') setLightbox(-1);
            else if (e.key === 'ArrowRight') setLightbox(i => Math.min(i + 1, total - 1));
            else if (e.key === 'ArrowLeft') setLightbox(i => Math.max(i - 1, 0));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightbox, data]);

    // Scroll-spy: highlight whichever section is in view in the compact-header tabs.
    // staff.length is a dep because the Team section mounts after its fetch resolves.
    useEffect(() => {
        if (!data) return;
        const els = ['section-photos', 'section-about', 'section-services', 'section-team', 'section-reviews']
            .map(sid => document.getElementById(sid)).filter(Boolean);
        if (!els.length) return;
        const io = new IntersectionObserver((entries) => {
            const vis = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
            if (vis[0]) setActiveSection(vis[0].target.id);
        }, { rootMargin: '-120px 0px -55% 0px', threshold: [0.05, 0.4] });
        els.forEach(el => io.observe(el));
        return () => io.disconnect();
    }, [data, staff.length]);

    // "Read more" only renders when the collapsed 4-line clamp truly truncates
    // (a character-count guess shows a dead button in the wide desktop column).
    // Only measured while collapsed, so "Show less" stays visible when expanded.
    useEffect(() => {
        if (aboutExpanded) return;
        const measure = () => {
            const el = aboutRef.current;
            if (el) setAboutClamped(el.scrollHeight > el.clientHeight + 1);
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [data, aboutExpanded]);

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    const formatSchedule = (sch) => {
        const ordered = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const short = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
        const enabled = ordered.filter(d => sch[d]?.enabled);
        if (!enabled.length) return [];
        const groups = [];
        let start = 0;
        for (let i = 1; i <= enabled.length; i++) {
            const prev = enabled[i - 1];
            const curr = enabled[i];
            const consecutive = curr && ordered.indexOf(curr) === ordered.indexOf(prev) + 1;
            const sameHours = curr &&
                sch[prev].slots[0]?.start === sch[curr].slots[0]?.start &&
                sch[prev].slots[0]?.end === sch[curr].slots[0]?.end;
            if (!consecutive || !sameHours) {
                const group = enabled.slice(start, i);
                const slot = sch[group[0]].slots[0];
                groups.push({
                    label: group.length === 1 ? short[group[0]] : `${short[group[0]]}–${short[group[group.length - 1]]}`,
                    hours: slot ? `${slot.start}–${slot.end}` : '',
                });
                start = i;
            }
        }
        return groups;
    };

    if (loading) return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    if (!data) return null;

    const { provider, categories, reviews } = data;
    const photos = provider.photos || [];
    const businessName = provider.businessProfile?.businessName || provider.name;
    const address = provider.address || provider.businessProfile?.address || '';
    const categoryKeys = Object.keys(categories);
    const activeServices = categories[activeCategory]?.services || [];

    const cur = currencySymbol(provider.currency);
    const isOwner = user?._id === provider._id;
    // De-duped services across every category → lowest price for the Book bar.
    const allServices = (() => {
        const seen = new Set(); const out = [];
        Object.values(categories || {}).forEach(c => (c.services || []).forEach(s => { if (!seen.has(s._id)) { seen.add(s._id); out.push(s); } }));
        return out;
    })();
    const minPrice = allServices.length ? Math.min(...allServices.map(s => Number(s.price) || 0)) : null;
    const description = provider.businessProfile?.description || '';

    // Fresha-style status: a colored headline ("Open"/"Closed") + a muted detail
    // ("until 17:00" / "opens on Friday at 09:00"), from the weekly working hours.
    const openStatus = (() => {
        if (!schedule) return null;
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayLabels = { sunday: 'Sunday', monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday' };
        const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
        const today = schedule[days[now.getDay()]];
        if (today?.enabled && (today.slots || []).length) {
            for (const s of today.slots) {
                const [sH, sM] = String(s.start).split(':').map(Number);
                const [eH, eM] = String(s.end).split(':').map(Number);
                if (nowMin >= sH * 60 + sM && nowMin < eH * 60 + eM) return { open: true, headline: 'Open', detail: `until ${s.end}` };
            }
            const next = today.slots.find(s => { const [h, m] = String(s.start).split(':').map(Number); return h * 60 + m > nowMin; });
            if (next) return { open: false, headline: 'Closed', detail: `opens today at ${next.start}` };
        }
        for (let i = 1; i <= 7; i++) {
            const key = days[(now.getDay() + i) % 7];
            const d = schedule[key];
            if (d?.enabled && (d.slots || []).length) {
                const when = i === 1 ? 'tomorrow' : `on ${dayLabels[key]}`;
                return { open: false, headline: 'Closed', detail: `opens ${when} at ${d.slots[0].start}` };
            }
        }
        return { open: false, headline: 'Closed', detail: '' };
    })();

    // Compact-header section tabs — only the sections that actually exist,
    // in the order they appear on the page (Fresha order).
    const sectionTabs = [
        photos.length > 0 && { id: 'section-photos', label: 'Photos' },
        description && { id: 'section-about', label: 'About' },
        { id: 'section-services', label: 'Services' },
        staff.length > 0 && { id: 'section-team', label: 'Team' },
        reviews.length > 0 && { id: 'section-reviews', label: 'Reviews' },
    ].filter(Boolean);

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* ── Hero: edge-to-edge photo carousel + floating controls (Fresha-style) ── */}
            <div id="section-photos" style={{ position: 'relative', scrollMarginTop: 'calc(var(--safe-top, 0px) + 104px)', background: 'var(--ink)' }}>
                {photos.length > 0 ? (
                    <div className="feed-carousel" onScroll={e => setHeroIdx(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))} style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
                        {photos.map((src, i) => (
                            <img key={i} src={cloudinaryThumb(src, 1200)} alt={`${businessName} photo ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" onClick={() => setLightbox(i)} style={{ flex: '0 0 100%', width: '100%', aspectRatio: '4 / 3', maxHeight: 'min(75vw, 480px)', objectFit: 'cover', scrollSnapAlign: 'start', display: 'block', cursor: 'pointer', background: 'var(--warm-gray)' }} />
                        ))}
                    </div>
                ) : (
                    <div style={{ aspectRatio: '16 / 9', maxHeight: '280px', background: 'linear-gradient(135deg, var(--ink) 0%, #1c1c1e 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(240,62,22,0.15) 0%, transparent 60%)' }} />
                        {provider.avatar
                            ? <img src={cloudinaryAvatar(provider.avatar)} alt={provider.name} style={{ width: '104px', height: '104px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', position: 'relative', zIndex: 1 }} />
                            : <div style={{ width: '104px', height: '104px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 700, color: 'var(--ink)', position: 'relative', zIndex: 1 }}>{getInitials(provider.name)}</div>}
                    </div>
                )}

                {/* Floating controls over the photo (the global navbar is hidden here).
                    No safe-area inset here: the .route-view wrapper already pads the top
                    with the safe-area clearance, so adding env() again double-offsets. */}
                <div style={{ position: 'absolute', top: '0.6rem', left: 0, right: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.5rem 1rem 0', pointerEvents: 'none' }}>
                    <button onClick={() => navigate('/')} aria-label="Back" style={floatBtn}><ChevronLeft size={22} strokeWidth={2.5} /></button>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button onClick={handleShare} aria-label="Share" style={floatBtn}><Share2 size={18} /></button>
                        {!isOwner && <button onClick={toggleFav} aria-label={isFav ? 'Saved' : 'Save'} style={floatBtn}><Heart size={19} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : 'var(--ink)'} /></button>}
                        {user && !isOwner && (
                            <div style={{ position: 'relative', pointerEvents: 'auto' }}>
                                <button onClick={() => setShowSettings(s => !s)} aria-label="Business options" style={floatBtn}><MoreHorizontal size={20} /></button>
                                {showSettings && (
                                    <>
                                        <div onClick={() => setShowSettings(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                                        <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 41, minWidth: '200px', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '14px', boxShadow: '0 12px 32px rgba(4,5,5,0.22)', overflow: 'hidden', padding: '0.35rem' }}>
                                            <button onClick={() => { setShowSettings(false); setShowTopUp(true); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '0.7rem 0.85rem', borderRadius: '10px', fontSize: '0.88rem', fontWeight: 600, fontFamily: 'var(--font-body)', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <svg width="16" height="16" fill="none" stroke="var(--gold-dark)" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M16 15h2"/></svg>
                                                Top up wallet
                                            </button>
                                            <button onClick={() => { setShowSettings(false); toggleBlock(); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '0.7rem 0.85rem', borderRadius: '10px', fontSize: '0.88rem', fontWeight: 600, fontFamily: 'var(--font-body)', color: blocked ? 'var(--charcoal)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/></svg>
                                                {blocked ? 'Unblock business' : 'Block business'}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
                {photos.length > 1 && (
                    <div style={{ position: 'absolute', bottom: '12px', right: '12px', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '0.72rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '99px', pointerEvents: 'none' }}>{heroIdx + 1} / {photos.length}</div>
                )}
            </div>

            {/* ── Header — name, category, rating, open line, location pill (Fresha stack) ── */}
            <div className="container" style={{ paddingTop: '1.25rem' }}>
                {/* The ref is on the title: the compact bar appears exactly when the
                    business name scrolls out of view (Fresha's trigger). */}
                <h1 ref={headerRef} style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.55rem, 5.5vw, 2.2rem)', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.15rem', lineHeight: 1.15 }}>{businessName}</h1>
                {provider.providerCategory && (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: '0 0 0.6rem' }}>{provider.providerCategory}</p>
                )}
                {provider.avgRating && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.95rem', marginBottom: '0.45rem' }}>
                        <Star size={16} fill="#f03e16" strokeWidth={0} />
                        <span style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{provider.avgRating}</span>
                        <span style={{ color: 'var(--gold-dark)', fontWeight: 600 }}>({provider.reviewCount})</span>
                    </div>
                )}
                {openStatus && (
                    // Color comes from the .profile-open-status classes (with dark-mode
                    // variants); the icon and headline inherit it via currentColor.
                    <div className={`profile-open-status ${openStatus.open ? 'is-open' : 'is-closed'}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9rem', marginBottom: '0.85rem' }}>
                        <Clock size={14} style={{ flexShrink: 0 }} />
                        <span style={{ fontWeight: 700 }}>{openStatus.headline}</span>
                        {openStatus.detail && <span style={{ color: 'var(--text-secondary)' }}>— {openStatus.detail}</span>}
                    </div>
                )}
                {address && (
                    <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.9rem', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--charcoal)', fontSize: '0.85rem', textDecoration: 'none', fontWeight: 500, boxShadow: 'var(--shadow-sm)' }}>
                        <MapPin size={16} style={{ color: 'var(--gold-dark)', flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{normalizeTown(address)}</span>
                    </a>
                )}
            </div>

            {/* ── Compact top bar (Fresha) — hidden until the header scrolls away, then
                 slides in with back + name + share/save and the section tabs. ── */}
            <div className="profile-compact-bar" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, background: 'var(--card-bg)', borderBottom: '1px solid var(--border)', boxShadow: '0 2px 10px rgba(4,5,5,0.07)', paddingTop: 'var(--safe-top, 0px)', transform: showCompact ? 'translateY(0)' : 'translateY(-110%)', transition: 'transform 0.25s ease, visibility 0.25s', visibility: showCompact ? 'visible' : 'hidden', pointerEvents: showCompact ? 'auto' : 'none' }}>
                <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '52px' }}>
                    <button onClick={() => navigate('/')} aria-label="Back" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', padding: '0.4rem 0.4rem 0.4rem 0' }}><ChevronLeft size={24} strokeWidth={2.5} /></button>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.05rem', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{businessName}</span>
                    <button onClick={handleShare} aria-label="Share" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', padding: '0.4rem' }}><Share2 size={19} /></button>
                    {!isOwner && <button onClick={toggleFav} aria-label={isFav ? 'Saved' : 'Save'} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.4rem' }}><Heart size={20} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : 'var(--charcoal)'} /></button>}
                </div>
                {sectionTabs.length > 1 && (
                    <div className="container" style={{ display: 'flex', gap: '0.25rem', overflowX: 'auto', scrollbarWidth: 'none' }}>
                        {sectionTabs.map(tab => {
                            const active = activeSection === tab.id;
                            return (
                                <button key={tab.id} type="button" onClick={() => scrollToSection(tab.id)} style={{ padding: '0.6rem 1rem', background: 'none', border: 'none', borderBottom: `2px solid ${active ? 'var(--charcoal)' : 'transparent'}`, color: active ? 'var(--charcoal)' : 'var(--text-muted)', fontWeight: active ? 700 : 500, fontSize: '0.9rem', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)', flexShrink: 0 }}>{tab.label}</button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="container" style={{ paddingTop: '1.5rem', paddingBottom: 'calc(4rem + 84px)' }}>
                <div className="provider-profile-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '2rem', alignItems: 'start' }}>

                    {/* Left — About, Services, Team, Reviews (Fresha page order) */}
                    <div>
                        {/* About — description with Read more, right under the header */}
                        {description && (
                            <div id="section-about" style={{ scrollMarginTop: 'calc(var(--safe-top, 0px) + 104px)', marginBottom: '2rem' }}>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.6rem' }}>About</h2>
                                <p ref={aboutRef} style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, ...(aboutExpanded ? {} : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>
                                    {description}
                                </p>
                                {aboutClamped && (
                                    <button onClick={() => setAboutExpanded(v => !v)} style={{ background: 'none', border: 'none', padding: '0.35rem 0 0', color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
                                        {aboutExpanded ? 'Show less' : 'Read more'}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Services — heading + category pills (Fresha-style) */}
                        <div id="section-services" style={{ scrollMarginTop: 'calc(var(--safe-top, 0px) + 104px)' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.85rem' }}>Services</h2>
                            <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.4rem', marginBottom: '1.1rem', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                                {categoryKeys.map(key => {
                                    const cat = categories[key];
                                    if (cat.services.length === 0 && key !== 'featured') return null;
                                    const active = activeCategory === key;
                                    return (
                                        <button key={key} onClick={(e) => { e.currentTarget.blur(); setActiveCategory(key); }} style={{
                                            flexShrink: 0, padding: '0.5rem 1rem', borderRadius: '999px',
                                            border: `1px solid ${active ? 'var(--charcoal)' : 'var(--border)'}`,
                                            background: active ? 'var(--charcoal)' : 'var(--card-bg)',
                                            // --off-white flips with the theme, so the active pill stays
                                            // readable in dark mode too (--charcoal is LIGHT there).
                                            color: active ? 'var(--off-white)' : 'var(--charcoal)',
                                            fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
                                            fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', outline: 'none',
                                        }}>
                                            {cat.name}{cat.services.length > 0 ? ` (${cat.services.length})` : ''}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Services list */}
                        {activeServices.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No services in this category yet</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {activeServices.map(service => (
                                    <div key={service._id} className="provider-service-row" style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>{service.name}</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>{service.description}</p>
                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{service.duration} min</span>
                                                {service.location && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📍 {normalizeTown(service.location)}</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', flexShrink: 0 }}>
                                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)' }}>{cur} {service.price}</span>
                                            {user?._id !== provider._id && (
                                                <button
                                                    onClick={() => navigate(`/book-appointment?serviceId=${service._id}&providerId=${provider._id}`)}
                                                    className="btn-primary"
                                                    style={{ padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
                                                >
                                                    Book
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Team — colored initial circles from the public staff endpoint */}
                        {staff.length > 0 && (
                            <div id="section-team" style={{ scrollMarginTop: 'calc(var(--safe-top, 0px) + 104px)', marginTop: '2.25rem' }}>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 1rem' }}>Team</h2>
                                <div style={{ display: 'flex', gap: '1.4rem', overflowX: 'auto', paddingBottom: '0.5rem', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                                    {staff.map(member => {
                                        // The hex+alpha tint only parses for 6-digit hex; anything
                                        // else (empty, named color) falls back to the brand tint.
                                        // The initial itself uses --charcoal (flips with the theme):
                                        // a dark staff hex would vanish on the dark-mode page.
                                        const hex = /^#[0-9a-f]{6}$/i.test(member.color || '') ? member.color : null;
                                        return (
                                        <div key={member._id} style={{ flexShrink: 0, width: '86px', textAlign: 'center' }}>
                                            <div style={{ width: '76px', height: '76px', borderRadius: '50%', margin: '0 auto 0.5rem', background: hex ? `${hex}22` : 'rgba(240,62,22,0.13)', color: hex ? 'var(--charcoal)' : 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1.7rem', fontWeight: 700 }}>
                                                {(member.name || '?').charAt(0).toUpperCase()}
                                            </div>
                                            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.name}</p>
                                            {member.role && <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.role}</p>}
                                        </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Reviews — headline stars + the latest reviews (Fresha-style) */}
                        {reviews.length > 0 && (
                            <div id="section-reviews" style={{ scrollMarginTop: 'calc(var(--safe-top, 0px) + 104px)', marginTop: '2.25rem' }}>
                                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.75rem' }}>Reviews</h2>
                                {provider.avgRating && (
                                    <div style={{ marginBottom: '1.25rem' }}>
                                        <div style={{ display: 'flex', gap: '3px', marginBottom: '0.35rem' }}>
                                            {[1, 2, 3, 4, 5].map(s => (
                                                <Star key={s} size={26} fill={s <= Math.round(provider.avgRating) ? '#f03e16' : 'var(--border)'} strokeWidth={0} />
                                            ))}
                                        </div>
                                        <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--charcoal)' }}>{provider.avgRating}</span>{' '}
                                        <span style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.95rem' }}>({provider.reviewCount})</span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    {reviews.map(review => (
                                        <div key={review._id} style={{ padding: '1rem 0', borderBottom: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.5rem' }}>
                                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--surface-sunken)', color: 'var(--charcoal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.95rem', flexShrink: 0 }}>
                                                    {(review.customer?.name || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div style={{ minWidth: 0 }}>
                                                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: 'var(--charcoal)' }}>{review.customer?.name || 'Client'}</p>
                                                    {review.createdAt && (
                                                        <p style={{ margin: '1px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                            {new Date(review.createdAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <StarDisplay rating={review.rating} />
                                            {review.comment && <p style={{ margin: '0.45rem 0 0', fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>{review.comment}</p>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right — provider info card */}
                    <div className="provider-profile-sidebar" style={{ position: 'sticky', top: 'calc(100px + env(safe-area-inset-top, 0px))' }}>
                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem' }}>
                            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Details</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {provider.providerCategory && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Category</span>
                                        <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '0.15rem 0.6rem', borderRadius: '99px', background: 'rgba(240,62,22,0.1)', color: 'var(--gold-dark)', border: '1px solid rgba(240,62,22,0.25)' }}>{provider.providerCategory}</span>
                                    </div>
                                )}
                                {provider.avgRating && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Rating</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <span style={{ color: 'var(--gold)', fontSize: '0.9rem' }}>★</span>
                                            <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{provider.avgRating} ({provider.reviewCount})</span>
                                        </div>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Services</span>
                                    <span style={{ fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{provider.serviceCount}</span>
                                </div>
                                {address && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', flexShrink: 0 }}>Address</span>
                                        <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.82rem', color: 'var(--gold-dark)', textAlign: 'right', fontWeight: '500', textDecoration: 'none' }}>{address}</a>
                                    </div>
                                )}
                                {schedule && (() => {
                                    const groups = formatSchedule(schedule);
                                    if (!groups.length) return null;
                                    return (
                                        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                                            <p style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>Working Hours</p>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                                {groups.map((g, i) => (
                                                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                                                        <span style={{ color: 'var(--text-secondary)' }}>{g.label}</span>
                                                        <span style={{ fontWeight: '600', color: 'var(--charcoal)' }}>{g.hours}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {user?._id !== provider._id && (
                                <button
                                    onClick={() => navigate(`/book-appointment?providerId=${provider._id}`)}
                                    className="btn-primary"
                                    style={{ width: '100%', padding: '0.875rem', marginTop: '1.25rem', fontSize: '0.95rem' }}
                                >
                                    Book Now →
                                </button>
                            )}
                        </div>

                        {/* Contact */}
                        {(provider.phone || provider.email || address) && (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem' }}>
                                <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Contact</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                                    {provider.phone && (
                                        <a href={`tel:${provider.phone}`} style={contactRowStyle}>
                                            <span style={contactIconStyle}><Phone size={15} /></span>
                                            <span>{provider.phone}</span>
                                        </a>
                                    )}
                                    {provider.phone && (
                                        <a href={`https://wa.me/${provider.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" style={contactRowStyle}>
                                            <span style={{ ...contactIconStyle, background: 'rgba(37,211,102,0.12)', color: '#1f9d57' }}><MessageCircle size={15} /></span>
                                            <span>WhatsApp</span>
                                        </a>
                                    )}
                                    {provider.email && (
                                        <a href={`mailto:${provider.email}`} style={contactRowStyle}>
                                            <span style={contactIconStyle}><Mail size={15} /></span>
                                            <span style={{ wordBreak: 'break-all' }}>{provider.email}</span>
                                        </a>
                                    )}
                                    {address && (
                                        <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" style={contactRowStyle}>
                                            <span style={contactIconStyle}><MapPin size={15} /></span>
                                            <span>{address}</span>
                                        </a>
                                    )}
                                </div>
                            </div>
                        )}

                    </div>
                </div>
            </div>

            {/* ── Sticky "Book now" bar (Fresha-style) — always reachable on mobile ── */}
            {!isOwner && (
                <div className="provider-book-bar" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 95, background: 'var(--card-bg)', borderTop: '1px solid var(--border)', boxShadow: '0 -4px 20px rgba(4,5,5,0.10)' }}>
                    <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.8rem 1.5rem calc(0.8rem + env(safe-area-inset-bottom, 0px))' }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{provider.serviceCount} service{provider.serviceCount !== 1 ? 's' : ''} available</div>
                            {minPrice != null && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>from {cur} {minPrice}</div>}
                        </div>
                        <button onClick={() => navigate(`/book-appointment?providerId=${provider._id}`)} className="btn-primary" style={{ padding: '0.85rem 1.9rem', borderRadius: '999px', fontSize: '0.95rem', fontWeight: 700, flexShrink: 0 }}>Book now</button>
                    </div>
                </div>
            )}

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {showTopUp && (
                <WalletTopUpModal
                    providerId={id}
                    providerName={businessName}
                    onClose={() => setShowTopUp(false)}
                    onDone={() => setShowTopUp(false)}
                />
            )}

            {/* Full-screen photo gallery */}
            {lightbox >= 0 && photos[lightbox] && (
                <div onClick={() => setLightbox(-1)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <button onClick={(e) => { e.stopPropagation(); setLightbox(-1); }} aria-label="Close" style={lightboxBtnStyle({ top: '1rem', right: '1rem' })}><X size={22} /></button>
                    {lightbox > 0 && (
                        <button onClick={(e) => { e.stopPropagation(); setLightbox(i => i - 1); }} aria-label="Previous photo" style={lightboxBtnStyle({ left: '0.75rem' })}><ChevronLeft size={26} /></button>
                    )}
                    <img src={cloudinaryThumb(photos[lightbox], 1400)} alt={`${businessName} photo ${lightbox + 1}`} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '86vh', objectFit: 'contain', borderRadius: '8px', boxShadow: '0 12px 48px rgba(0,0,0,0.5)' }} />
                    {lightbox < photos.length - 1 && (
                        <button onClick={(e) => { e.stopPropagation(); setLightbox(i => i + 1); }} aria-label="Next photo" style={lightboxBtnStyle({ right: '0.75rem' })}><ChevronRight size={26} /></button>
                    )}
                    <div style={{ position: 'absolute', bottom: '1.1rem', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.85)', fontSize: '0.8rem', fontWeight: '600', background: 'rgba(0,0,0,0.4)', padding: '0.25rem 0.75rem', borderRadius: '99px' }}>{lightbox + 1} / {photos.length}</div>
                </div>
            )}
        </div>
    );
};

export default ProviderProfilePage;