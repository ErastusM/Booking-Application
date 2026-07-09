import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { providerMarketService, favoriteService, appointmentService } from '../services';
import { Search, Star, ArrowRight, Heart, MapPin } from 'lucide-react';
import { cloudinaryThumb } from '../utils/cloudinary';
import { normalizeTown } from '../utils/namibiaTowns';

const ProviderCard = ({ p, badge, isFav, onToggleFav }) => {
    const cover = p.coverImage || p.avatar || null;
    const initial = (p.businessName || p.name || '?').charAt(0).toUpperCase();
    const loc = p.location || p.businessProfile?.address || '';
    const reviews = p.reviewCount > 0 ? `${p.reviewCount} review${p.reviewCount !== 1 ? 's' : ''}` : 'No reviews yet';
    return (
        <Link
            to={`/providers/${p._id}`}
            className="home-provider-card"
            style={{ flex: '0 0 210px', width: '210px', display: 'block', textDecoration: 'none', scrollSnapAlign: 'start', background: 'transparent' }}
        >
            <div className="home-provider-card__media" style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: '16px', overflow: 'hidden', background: cover ? 'var(--warm-gray)' : 'linear-gradient(135deg, #1c1c1e 0%, #040505 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
                {cover
                    ? <img src={cloudinaryThumb(cover, 800)} alt={p.businessName || p.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: '700', color: 'var(--gold)' }}>{initial}</span>}
                {badge && (
                    <span style={{ position: 'absolute', top: '10px', left: '10px', background: badge === 'New' ? 'var(--ink)' : 'rgba(255,255,255,0.95)', color: badge === 'New' ? '#fff' : 'var(--charcoal)', fontSize: '0.7rem', fontWeight: '700', padding: '3px 10px', borderRadius: '999px' }}>{badge}</span>
                )}
                <button
                    type="button"
                    aria-label={isFav ? 'Remove from saved' : 'Save to favorites'}
                    onClick={(e) => onToggleFav(e, String(p._id))}
                    style={{ position: 'absolute', top: '8px', right: '8px', width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}
                >
                    <Heart size={16} strokeWidth={2} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : '#52525b'} />
                </button>
            </div>
            <div style={{ padding: '0.6rem 0.15rem 0' }}>
                <p style={{ fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.95rem', margin: '0 0 2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.businessName || p.name}</p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{loc || ' '}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.providerCategory ? `${p.providerCategory} · ` : ''}{reviews}
                    </span>
                    {p.avgRating && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.8rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0 }}>
                            <Star size={13} fill="#f03e16" strokeWidth={0} /> {p.avgRating}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
};

// A business as a social-media post: header (avatar + name + location), a hero photo
// carousel, an actions row (like + rating) and a caption. Single tap opens the profile;
// double tap likes with a heart burst — the familiar Instagram/TikTok gestures.
const FeedCard = ({ p, isFav, likeCount, onToggleFav }) => {
    const navigate = useNavigate();
    const id = String(p._id);
    const photos = ((p.photos && p.photos.length) ? p.photos : (p.coverImage ? [p.coverImage] : [])).slice(0, 5);
    const hasPhotos = photos.length > 0;
    const initial = (p.businessName || p.name || '?').charAt(0).toUpperCase();
    const loc = normalizeTown(p.location || p.businessProfile?.address || 'Namibia');
    const go = () => navigate(`/providers/${id}`);

    const [idx, setIdx] = useState(0);            // active carousel photo (for the dots)
    const [burst, setBurst] = useState(false);    // heart-burst animation on double-tap
    const burstTimer = useRef(null);
    const tap = useRef({ n: 0, t: null });

    useEffect(() => () => { clearTimeout(burstTimer.current); clearTimeout(tap.current.t); }, []);

    const fireBurst = () => {
        setBurst(true);
        clearTimeout(burstTimer.current);
        burstTimer.current = setTimeout(() => setBurst(false), 750);
    };

    // One tap → open profile (after a short wait); a second tap within that window →
    // like (never unlike, like Instagram) + heart burst, and cancel the navigation.
    const onMediaTap = () => {
        tap.current.n += 1;
        if (tap.current.n === 1) {
            tap.current.t = setTimeout(() => { tap.current.n = 0; go(); }, 250);
        } else {
            clearTimeout(tap.current.t);
            tap.current.n = 0;
            if (!isFav) onToggleFav({ preventDefault() {}, stopPropagation() {} }, id);
            fireBurst();
        }
    };

    return (
        // height:100% + flex column + the CTA's marginTop:auto keep every card
        // in a section row the SAME height regardless of how its text wraps.
        <article style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '18px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)', height: '100%', display: 'flex', flexDirection: 'column' }}>

            {/* Header — tap to open profile */}
            <div onClick={go} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', cursor: 'pointer' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {p.avatar
                        ? <img src={cloudinaryThumb(p.avatar, 80)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <span style={{ fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--gold)', fontSize: '1rem' }}>{initial}</span>}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.95rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.businessName || p.name}</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '1px 0 0', display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <MapPin size={11} style={{ flexShrink: 0 }} /> {loc}
                    </p>
                </div>
                {p.providerCategory && (
                    <span style={{ flexShrink: 0, fontSize: '0.68rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', background: 'rgba(240,62,22,0.12)', color: 'var(--gold-dark)' }}>{p.providerCategory}</span>
                )}
            </div>

            {/* Media — the hero. Double-tap to like. */}
            <div style={{ position: 'relative' }} onClick={onMediaTap}>
                {hasPhotos ? (
                    <div className="feed-carousel" onScroll={e => setIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))} style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', cursor: 'pointer' }}>
                        {photos.map((src, i) => (
                            <img key={i} src={cloudinaryThumb(src, 1000)} alt={`${p.businessName || p.name} photo ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="feed-media-img" style={{ flex: '0 0 100%', width: '100%', aspectRatio: '4 / 5', objectFit: 'cover', scrollSnapAlign: 'start', display: 'block', background: 'var(--warm-gray)' }} />
                        ))}
                    </div>
                ) : (
                    // Compact placeholder — no large empty block. Nudges the business to add photos.
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', padding: '1.1rem 1rem', background: 'linear-gradient(135deg, var(--surface-sunken), var(--warm-gray))', cursor: 'pointer' }}>
                        <div style={{ width: '48px', height: '48px', borderRadius: '12px', flexShrink: 0, background: 'var(--ink)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: '700' }}>{initial}</div>
                        <div style={{ minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.9rem' }}>Photos coming soon</p>
                            <p style={{ margin: '2px 0 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>Tap to view {p.businessName || p.name}</p>
                        </div>
                    </div>
                )}
                {hasPhotos && photos.length > 1 && (
                    <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '5px', pointerEvents: 'none' }}>
                        {photos.map((_, i) => <span key={i} style={{ width: i === idx ? '7px' : '6px', height: i === idx ? '7px' : '6px', borderRadius: '50%', background: i === idx ? '#fff' : 'rgba(255,255,255,0.6)', boxShadow: '0 1px 2px rgba(0,0,0,0.35)', transition: 'all 0.15s' }} />)}
                    </div>
                )}
                {burst && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <Heart className="heart-burst" size={96} fill="#fff" color="#fff" />
                    </div>
                )}
            </div>

            {/* Actions — like + count on the left, rating on the right */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.95rem 0.15rem' }}>
                <button
                    type="button"
                    aria-label={isFav ? 'Unlike' : 'Like'}
                    onClick={(e) => onToggleFav(e, id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: 'none', background: 'none', cursor: 'pointer', padding: '2px', color: 'var(--charcoal)' }}
                >
                    <Heart size={22} strokeWidth={2} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : 'var(--text-secondary)'} />
                    <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>{likeCount > 0 ? `${likeCount}` : ''}</span>
                </button>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)' }}>
                    {p.avgRating
                        ? <><Star size={15} fill="#f03e16" strokeWidth={0} /> {p.avgRating}<span style={{ color: 'var(--text-muted)', fontWeight: '500' }}>({p.reviewCount || 0})</span></>
                        : <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--gold-dark)', fontWeight: '600' }}><Star size={14} fill="#f03e16" strokeWidth={0} /> New on Bookplus</span>}
                </span>
            </div>

            {/* Caption — tap to open profile */}
            <div onClick={go} style={{ padding: '0.1rem 0.95rem 0.6rem', cursor: 'pointer' }}>
                <span style={{ fontWeight: '700', color: 'var(--charcoal)', fontSize: '0.9rem' }}>{p.businessName || p.name}</span>
                {p.minPrice != null && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> · Starting at NAD {p.minPrice}</span>}
                {p.serviceCount > 0 && (
                    <p style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {p.serviceCount} {p.serviceCount === 1 ? 'service' : 'services'} available
                    </p>
                )}
                {p.description && (
                    <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.description}</p>
                )}
            </div>

            {/* Primary action — pinned to the card bottom so rows stay level */}
            <div style={{ padding: '0 0.95rem 0.95rem', marginTop: 'auto' }}>
                <Link
                    to={`/book-appointment?providerId=${id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="btn-primary"
                    style={{ display: 'block', width: '100%', textAlign: 'center', padding: '0.65rem', fontSize: '0.88rem', fontWeight: '700', textDecoration: 'none' }}
                >
                    Book Appointment
                </Link>
            </div>
        </article>
    );
};

const Home = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [searchLoc, setSearchLoc] = useState('');
    const [searchDate, setSearchDate] = useState('');
    const [searchTime, setSearchTime] = useState('');
    const [providers, setProviders] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [myAppointments, setMyAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const heroCopyRef = useRef(null);
    const searchWrapRef = useRef(null);

    // Gently fade the hero copy as it scrolls away and let the search bar settle under
    // the navbar with a soft shadow. Styles are written directly in a rAF callback (no
    // per-frame re-render of the feed), so it tracks the scroll smoothly — no sudden snap.
    useEffect(() => {
        let raf = 0;
        const apply = () => {
            raf = 0;
            const y = window.scrollY;
            const copy = heroCopyRef.current;
            if (copy) copy.style.opacity = String(Math.max(0, 1 - y / 220));
            const wrap = searchWrapRef.current;
            if (wrap) {
                const stuck = y > 6;
                wrap.style.boxShadow = stuck ? 'var(--shadow-sm)' : 'none';
                wrap.style.borderBottomColor = stuck ? 'var(--border)' : 'transparent';
            }
        };
        const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
        window.addEventListener('scroll', onScroll, { passive: true });
        apply();
        return () => { window.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
    }, []);

    useEffect(() => {
        providerMarketService.getAllProviders()
            .then(res => setProviders(res.data.data || []))
            .catch(() => setProviders([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!user) { setFavorites([]); return; }
        favoriteService.list()
            .then(res => setFavorites((res.data.data || []).map(String)))
            .catch(() => {});
    }, [user]);

    // "Book again" — the user's own booking history powers one-tap rebooks.
    useEffect(() => {
        if (!user) { setMyAppointments([]); return; }
        appointmentService.getCustomerAppointments()
            .then(res => setMyAppointments(res.data.data || []))
            .catch(() => {});
    }, [user]);

    // One card per distinct service the user has actually had, newest first.
    const bookAgainItems = useMemo(() => {
        const seen = new Set();
        return [...myAppointments]
            .filter(a => a.service && a.status !== 'cancelled')
            .sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate))
            .filter(a => {
                const sid = a.service._id;
                if (!sid || seen.has(sid)) return false;
                seen.add(sid);
                return true;
            })
            .slice(0, 4)
            .map(a => {
                const prov = a.service.provider;
                const providerId = prov?._id || prov || '';
                const provObj = providers.find(p => String(p._id) === String(providerId));
                return {
                    serviceId: a.service._id,
                    serviceName: a.service.name,
                    price: a.totalPrice ?? a.service.price,
                    providerId,
                    providerName: prov?.businessProfile?.businessName || prov?.name || provObj?.businessName || provObj?.name || 'Business',
                    image: prov?.avatar || prov?.portfolio?.images?.[0] || provObj?.coverImage || provObj?.avatar || null,
                };
            });
    }, [myAppointments, providers]);

    // "Recently viewed" — profile visits recorded client-side (newest first).
    const recentlyViewed = useMemo(() => {
        try {
            const ids = JSON.parse(localStorage.getItem('bp_recent_providers') || '[]');
            return ids.map(id => providers.find(p => String(p._id) === String(id))).filter(Boolean).slice(0, 8);
        } catch { return []; }
    }, [providers]);

    const allTowns = useMemo(() => (
        [...new Set(providers.map(p => normalizeTown(p.location || p.businessProfile?.address || '')).filter(Boolean))].sort()
    ), [providers]);

    const totalServices = useMemo(() => providers.reduce((n, p) => n + (p.serviceCount || 0), 0), [providers]);

    const favSet = useMemo(() => new Set(favorites), [favorites]);

    // One heart = private save + public like. Optimistically flip the save state AND the
    // displayed like count, then reconcile with the server (revert both on failure).
    const bumpLike = (id, delta) => setProviders(prev => prev.map(p =>
        String(p._id) === id ? { ...p, likesCount: Math.max(0, (p.likesCount || 0) + delta) } : p));

    const toggleFav = async (e, id) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) { navigate('/login'); return; }
        const wasFav = favorites.includes(id);
        setFavorites(prev => wasFav ? prev.filter(x => x !== id) : [...prev, id]);
        bumpLike(id, wasFav ? -1 : 1);
        try {
            const res = await favoriteService.toggle(id);
            setFavorites((res.data.data || []).map(String));
        } catch {
            favoriteService.list().then(r => setFavorites((r.data.data || []).map(String))).catch(() => {});
            bumpLike(id, wasFav ? 1 : -1); // revert the optimistic like
        }
    };

    // Vertical "Discover" feed ranking: rating is primary, likes give a small capped
    // boost, and providers with no rating yet get a neutral score so they're not buried
    // on day one.
    const discoverFeed = useMemo(() => {
        const score = (x) => (x.avgRating || 4.2) + Math.min(0.5, (x.likesCount || 0) * 0.02);
        return [...providers].sort((a, b) => score(b) - score(a));
    }, [providers]);

    // Fresha-style desktop sections — all computed from the one providers payload,
    // so they light up automatically as data grows. Overlap while data is sparse
    // is deliberate (Fresha does the same); each section renders only when it
    // has something to show.
    const homeSections = useMemo(() => ([
        { key: 'recommended', title: 'Recommended', sub: 'Top-rated businesses, picked for you', items: discoverFeed.slice(0, 8) },
        { key: 'new', title: 'New on Bookplus', sub: 'Fresh businesses that just joined', items: [...providers].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 8) },
        { key: 'trending', title: 'Trending now', sub: 'Getting the most love right now', items: [...providers].sort((a, b) => (b.likesCount || 0) - (a.likesCount || 0) || (b.reviewCount || 0) - (a.reviewCount || 0)).slice(0, 8) },
        { key: 'top', title: 'Top rated', sub: 'The highest scores from real clients', items: providers.filter(x => x.avgRating != null).sort((a, b) => b.avgRating - a.avgRating).slice(0, 8) },
    ]).filter(sec => sec.items.length > 0), [providers, discoverFeed]);

    // Featured businesses — a photo-rich horizontal row right under the hero so the
    // home always leads with real, tappable businesses (prefer ones with a cover
    // photo; ranked by rating, then likes/reviews).
    const featuredBusinesses = useMemo(() => {
        const withPhoto = providers.filter(p => p.coverImage || p.avatar);
        const pool = withPhoto.length ? withPhoto : providers;
        return [...pool].sort((a, b) =>
            (b.avgRating || 0) - (a.avgRating || 0)
            || (b.likesCount || 0) - (a.likesCount || 0)
            || (b.reviewCount || 0) - (a.reviewCount || 0)
        ).slice(0, 12);
    }, [providers]);

    // Infinite scroll: reveal the feed in chunks and pull in more as a sentinel near the
    // bottom scrolls into view — no pagination, no "next page" buttons.
    const PAGE = 6;
    const [visibleCount, setVisibleCount] = useState(PAGE);
    const sentinelRef = useRef(null);
    const hasMore = visibleCount < discoverFeed.length;

    useEffect(() => { setVisibleCount(PAGE); }, [discoverFeed.length]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + PAGE, discoverFeed.length)); },
            { rootMargin: '700px 0px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [discoverFeed.length, loading]);

    const handleSearch = (e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        if (query.trim()) params.set('q', query.trim());
        if (searchLoc) params.set('loc', searchLoc);
        if (searchDate) params.set('date', searchDate);
        if (searchDate && searchTime) params.set('time', searchTime);
        const qs = params.toString();
        navigate(qs ? `/services?${qs}` : '/services');
    };

    return (
        <div style={{ background: 'var(--off-white)' }}>

            {/* ── Hero copy — fades and scrolls away gently as the feed takes over ── */}
            <section className="home-hero" style={{ position: 'relative', overflow: 'hidden', background: 'var(--off-white)' }}>
                <div aria-hidden="true" className="home-hero-wash" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
                <div ref={heroCopyRef} className="container" style={{ position: 'relative', textAlign: 'center', maxWidth: '860px', marginLeft: 'auto', marginRight: 'auto', willChange: 'opacity' }}>
                    <p className="fade-up home-hero-eyebrow" style={{ color: 'var(--gold-dark)', fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '1.1rem' }}>Premium booking, simplified</p>
                    <h1 className="fade-up fade-up-delay-1" style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.6rem, 6.2vw, 4.6rem)', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 1.25rem' }}>
                        Book trusted <span style={{ color: 'var(--gold)' }}>local services</span>
                    </h1>
                    <p className="fade-up fade-up-delay-2 home-hero-sub" style={{ color: 'var(--text-secondary)', fontSize: 'clamp(1rem, 2vw, 1.2rem)', lineHeight: 1.65, maxWidth: '680px', margin: '0 auto 1.25rem' }}>
                        Discover top-rated salons, barbers, wellness studios, automotive services and more — booked in seconds.
                    </p>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        <span style={{ display: 'inline-flex', gap: '1px' }}>
                            {[0, 1, 2, 3, 4].map(i => <Star key={i} size={14} fill="#f03e16" strokeWidth={0} />)}
                        </span>
                        Loved by clients across Namibia
                    </div>
                </div>
            </section>

            {/* ── Sticky search — settles under the navbar while the feed scrolls ── */}
            <div ref={searchWrapRef} style={{
                position: 'sticky', top: 'calc(64px + env(safe-area-inset-top, 0px))', zIndex: 100,
                background: 'var(--off-white)',
                padding: '0.75rem 0',
                borderBottom: '1px solid transparent',
                transition: 'box-shadow 0.25s ease, border-color 0.25s ease',
            }}>
                <div className="container home-search-inner" style={{ marginLeft: 'auto', marginRight: 'auto' }}>
                    <form onSubmit={handleSearch} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '999px', padding: '0.4rem 0.4rem 0.4rem 1.25rem', boxShadow: '0 6px 22px rgba(4,5,5,0.10)' }}>
                        <Search size={19} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="All treatments and venues"
                            aria-label="Search services or businesses"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: '1rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}
                        />
                        {/* Location + when segments — desktop only; mobile keeps the plain pill */}
                        <div className="home-search-when">
                            <MapPin size={15} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                            <select value={searchLoc} onChange={e => setSearchLoc(e.target.value)} aria-label="Location" style={{ maxWidth: '150px' }}>
                                <option value="">All locations</option>
                                {allTowns.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className="home-search-when">
                            <input
                                type="date"
                                value={searchDate}
                                min={(d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date())}
                                onChange={e => setSearchDate(e.target.value)}
                                aria-label="Date"
                            />
                            <select value={searchTime} onChange={e => setSearchTime(e.target.value)} aria-label="Time" disabled={!searchDate} style={{ opacity: searchDate ? 1 : 0.45 }}>
                                <option value="">Any time</option>
                                {Array.from({ length: 13 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`).map(t => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <button type="submit" className="btn-primary" style={{ borderRadius: '999px', padding: '0.7rem 1.6rem', flexShrink: 0 }}>Search</button>
                    </form>
                    {/* Honest live stat, Fresha-style placement */}
                    {!loading && providers.length > 0 && (
                        <p className="home-hero-stat" style={{ textAlign: 'center', margin: '0.9rem 0 0', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            <strong style={{ color: 'var(--charcoal)', fontWeight: 700 }}>{totalServices}</strong> service{totalServices !== 1 ? 's' : ''} from{' '}
                            <strong style={{ color: 'var(--charcoal)', fontWeight: 700 }}>{providers.length}</strong> local business{providers.length !== 1 ? 'es' : ''} — booked in seconds
                        </p>
                    )}
                </div>
            </div>

            {/* ── Featured businesses — photo-rich row right under the hero (all viewports) ── */}
            {!loading && featuredBusinesses.length > 0 && (
                <section style={{ paddingTop: '1.25rem' }}>
                    <div className="container">
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.9rem', gap: '1rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.35rem, 3vw, 1.7rem)', fontWeight: 700, color: 'var(--charcoal)', margin: 0 }}>Featured businesses</h2>
                            <Link to="/services" style={{ color: 'var(--gold-dark)', fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none', flexShrink: 0, whiteSpace: 'nowrap' }}>See all →</Link>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '0.5rem', WebkitOverflowScrolling: 'touch' }}>
                            {featuredBusinesses.map(p => (
                                <ProviderCard key={`feat-${p._id}`} p={p} isFav={favSet.has(String(p._id))} onToggleFav={toggleFav} />
                            ))}
                        </div>
                    </div>
                </section>
            )}

            {/* ── Desktop: Fresha-style sections (hidden on mobile) ── */}
            <section className="home-sections-desktop" style={{ paddingTop: '0.75rem', paddingBottom: '3rem' }}>
                <div className="container">
                    {/* Book again — one-tap rebooks from the user's own history */}
                    {!loading && bookAgainItems.length > 0 && (
                        <div style={{ marginBottom: '2.75rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 1.1rem' }}>Book again</h2>
                            <div className="home-section-grid">
                                {bookAgainItems.map(item => (
                                    <div key={item.serviceId} style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '16px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                                        <Link to={`/providers/${item.providerId}`} style={{ display: 'block', textDecoration: 'none' }}>
                                            <div style={{ aspectRatio: '16 / 9', background: item.image ? 'var(--warm-gray)' : 'linear-gradient(135deg, #1c1c1e 0%, #040505 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {item.image
                                                    ? <img src={cloudinaryThumb(item.image, 700)} alt={item.providerName} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                                    : <span style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700, color: 'var(--gold)' }}>{item.providerName.charAt(0).toUpperCase()}</span>}
                                            </div>
                                        </Link>
                                        <div style={{ padding: '0.75rem 0.9rem 0.9rem' }}>
                                            <p style={{ margin: 0, fontWeight: 700, color: 'var(--charcoal)', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.providerName}</p>
                                            <p style={{ margin: '2px 0 0.7rem', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>NAD {item.price} · {item.serviceName}</p>
                                            <button
                                                onClick={() => navigate(`/book-appointment?providerId=${item.providerId}&serviceId=${item.serviceId}`)}
                                                className="btn-outline"
                                                style={{ width: '100%', padding: '0.5rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                                            >
                                                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
                                                Rebook
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recently viewed — client-side history of profile visits */}
                    {!loading && recentlyViewed.length > 0 && (
                        <div style={{ marginBottom: '2.75rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 1.1rem' }}>Recently viewed</h2>
                            <div className="home-section-grid">
                                {recentlyViewed.map(x => (
                                    <FeedCard key={`recent-${x._id}`} p={x} isFav={favSet.has(String(x._id))} likeCount={x.likesCount || 0} onToggleFav={toggleFav} />
                                ))}
                            </div>
                        </div>
                    )}

                    {!loading && providers.length === 0 && (
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <p style={{ margin: 0, fontSize: '0.95rem' }}>New businesses are joining soon. Check back shortly.</p>
                        </div>
                    )}
                    {!loading && homeSections.map(sec => (
                        <div key={sec.key} style={{ marginBottom: '2.75rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.25rem' }}>{sec.title}</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1.1rem' }}>{sec.sub}</p>
                            <div className="home-section-grid">
                                {sec.items.map(x => (
                                    <FeedCard key={`${sec.key}-${x._id}`} p={x} isFav={favSet.has(String(x._id))} likeCount={x.likesCount || 0} onToggleFav={toggleFav} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Discover feed (vertical, photo-rich) — the primary MOBILE home feed ── */}
            <section className="home-feed-mobile" style={{ paddingTop: '0.5rem', paddingBottom: '3.5rem' }}>
                <div className="container">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>Discover</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>Browse businesses near you — swipe their photos, tap to book.</p>
                    <div className="discover-feed">
                        {loading ? (
                            [0, 1, 2].map(i => (
                                <div key={i} style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                    <div style={{ aspectRatio: '4 / 5', background: 'var(--warm-gray)' }} />
                                    <div style={{ padding: '0.85rem 1.1rem 1.05rem' }}>
                                        <div style={{ height: '14px', width: '60%', background: 'var(--warm-gray)', borderRadius: '6px', marginBottom: '8px' }} />
                                        <div style={{ height: '10px', width: '40%', background: 'var(--warm-gray)', borderRadius: '6px' }} />
                                    </div>
                                </div>
                            ))
                        ) : providers.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>New businesses are joining soon. Check back shortly.</p>
                            </div>
                        ) : (
                            <>
                                {discoverFeed.slice(0, visibleCount).map(p => (
                                    <FeedCard key={p._id} p={p} isFav={favSet.has(String(p._id))} likeCount={p.likesCount || 0} onToggleFav={toggleFav} />
                                ))}
                                {hasMore && (
                                    <div ref={sentinelRef} style={{ display: 'flex', justifyContent: 'center', padding: '1.25rem 0' }}>
                                        <div style={{ width: '26px', height: '26px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                    </div>
                                )}
                                {!hasMore && discoverFeed.length > PAGE && (
                                    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '0.75rem 0 0' }}>You're all caught up ✨</p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </section>


            {/* ── CTA — thin inline strip, button sits right after the words ── */}
            <section style={{ background: 'var(--ink)', padding: '1rem 0' }}>
                <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem 1.25rem', flexWrap: 'wrap', textAlign: 'center' }}>
                    <p style={{ color: 'rgba(255,255,255,0.72)', fontSize: '0.95rem', margin: 0 }}>
                        <span style={{ color: 'white', fontWeight: '700' }}>{user?.role === 'provider' ? 'Grow your business with Bookplus.' : 'Ready when you are.'}</span>{' '}
                        {user?.role === 'provider' ? 'Run everything from one workspace.' : 'Find a business, pick a time, and you’re booked.'}
                    </p>
                    <Link to={user ? (user.role === 'provider' ? '/dashboard' : '/services') : '/register'} className="btn-primary" style={{ fontSize: '0.9rem', padding: '0.6rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                        {user ? (user.role === 'provider' ? 'Go to dashboard' : 'Browse businesses') : 'Get started'} <ArrowRight size={16} strokeWidth={2} />
                    </Link>
                </div>
            </section>
        </div>
    );
};

export default Home;
