import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { providerMarketService, favoriteService, appointmentService, serviceService } from '../services';
import { Search, Star, ArrowRight, Heart, MapPin } from 'lucide-react';
import { cloudinaryThumb } from '../utils/cloudinary';
import { normalizeTown } from '../utils/namibiaTowns';
import { currencySymbol } from '../utils/currency';
import Seo from '../components/Seo';

// Provider dashboards live in the business app — cross-app hops are hard
// navigations (like the Navbar's) so the other app boots fresh with its own data.
const BUSINESS_URL = import.meta.env.VITE_BUSINESS_URL || 'http://localhost:3003';

const ProviderCard = ({ p, badge, isFav, onToggleFav }) => {
    const cover = p.coverImage || p.avatar || null;
    const initial = (p.businessName || p.name || '?').charAt(0).toUpperCase();
    const loc = p.location || p.businessProfile?.address || '';
    const reviews = p.reviewCount > 0 ? `${p.reviewCount} review${p.reviewCount !== 1 ? 's' : ''}` : 'No reviews yet';
    return (
        <Link
            to={`/providers/${p._id}`}
            className="home-provider-card"
            style={{ display: 'block', width: '100%', textDecoration: 'none', background: 'transparent' }}
        >
            <div className="home-provider-card__media" style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: '16px', overflow: 'hidden', background: cover ? 'var(--warm-gray)' : 'linear-gradient(135deg, #1c1c1e 0%, #040505 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
                {cover
                    ? <img key={`${p._id}-cover`} src={cloudinaryThumb(cover, 800)} alt={p.businessName || p.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <span style={{ fontFamily: 'var(--font-display)', fontSize: '2.6rem', fontWeight: '700', color: 'var(--gold)' }}>{initial}</span>}
                {badge && (
                    <span style={{ position: 'absolute', top: '10px', left: '10px', background: badge === 'New' ? 'var(--ink)' : 'rgba(255,255,255,0.95)', color: badge === 'New' ? '#fff' : 'var(--charcoal)', fontSize: '0.7rem', fontWeight: '700', padding: '3px 10px', borderRadius: '999px' }}>{badge}</span>
                )}
                <button
                    type="button"
                    aria-label={isFav ? 'Remove from saved' : 'Save to favorites'}
                    onClick={(e) => onToggleFav(e, String(p._id))}
                    // 44x44 hit area (transparent) with a 30px visual circle inside so the
                    // tap target clears the 44px minimum without growing the button visually.
                    style={{ position: 'absolute', top: '1px', right: '1px', width: '44px', height: '44px', border: 'none', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                >
                    <span style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'rgba(255,255,255,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
                        <Heart size={16} strokeWidth={2} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : '#52525b'} />
                    </span>
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
    // Enter/Space opens the profile so keyboard/switch users can use the card body,
    // not just the Book button and heart.
    const onGoKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };

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
            tap.current.t = setTimeout(() => { tap.current.n = 0; go(); }, 220);
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
            <div role="button" tabIndex={0} onClick={go} onKeyDown={onGoKey} aria-label={`View ${p.businessName || p.name}`} className="pressable" style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.7rem 0.85rem', cursor: 'pointer' }}>
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
            {/* Media & caption are pointer-only (double-tap to like / tap to open);
                the header above is the single keyboard-focusable "View X" affordance,
                so these stay out of the a11y tree to avoid 3 duplicate buttons/card. */}
            <div onClick={onMediaTap} style={{ position: 'relative' }}>
                {hasPhotos ? (
                    <div className="feed-carousel" onScroll={e => setIdx(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))} style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory', cursor: 'pointer' }}>
                        {photos.map((src, i) => (
                            // Key by provider id + src (not the array index) so a different
                            // business's photo never reuses this <img> node and paints the
                            // wrong company's picture during a re-render.
                            <img key={`${id}-${src}`} src={cloudinaryThumb(src, 1000)} alt={`${p.businessName || p.name} photo ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="feed-media-img" style={{ flex: '0 0 100%', width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', scrollSnapAlign: 'start', display: 'block', background: 'var(--warm-gray)' }} />
                        ))}
                    </div>
                ) : (
                    // Same aspect ratio as a photo so every card in the feed is the SAME
                    // height, even for a business that hasn't added photos yet.
                    <div className="feed-media-img" style={{ aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.7rem', padding: '1rem', background: 'linear-gradient(135deg, var(--surface-sunken), var(--warm-gray))', cursor: 'pointer' }}>
                        <div style={{ width: '68px', height: '68px', borderRadius: '18px', flexShrink: 0, background: 'var(--ink)', color: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: '700' }}>{initial}</div>
                        <div style={{ textAlign: 'center' }}>
                            <p style={{ margin: 0, fontWeight: '600', color: 'var(--charcoal)', fontSize: '0.92rem' }}>Photos coming soon</p>
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
                {p.minPrice != null && <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> · Starting at {currencySymbol(p.currency)} {p.minPrice}</span>}
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
    const [activeCategory, setActiveCategory] = useState(''); // '' = all
    const [nearMeCity, setNearMeCity] = useState('');
    const [nearMeLoading, setNearMeLoading] = useState(false);
    const [openingsMap, setOpeningsMap] = useState(null); // providerId → openings, when a date is set
    const [providers, setProviders] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [myAppointments, setMyAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const searchWrapRef = useRef(null);

    // Let the sticky search bar settle under the navbar with a soft shadow once the
    // feed scrolls. Styles are written directly in a rAF callback (no per-frame
    // re-render of the feed), so it tracks the scroll smoothly — no sudden snap.
    useEffect(() => {
        let raf = 0;
        const apply = () => {
            raf = 0;
            const y = window.scrollY;
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

    // The search bar's placeholder promises "services or businesses", but provider
    // cards only carry a serviceCount, not the names — pull the public catalogue once
    // so the search box can actually match a service name (e.g. "haircut") to the
    // business that offers it, not just business/location/category text.
    const [allServices, setAllServices] = useState([]);
    useEffect(() => {
        serviceService.getAllServices()
            .then(res => setAllServices(res.data.data || []))
            .catch(() => setAllServices([]));
    }, []);
    const serviceNamesByProvider = useMemo(() => {
        const map = new Map();
        allServices.forEach(s => {
            const pid = String(s.provider?._id || s.provider || '');
            if (!pid || !s.name) return;
            if (!map.has(pid)) map.set(pid, []);
            map.get(pid).push(s.name.toLowerCase());
        });
        return map;
    }, [allServices]);

    // Availability-first: when a date (and optional time) is picked, fetch which
    // businesses have a real opening then, so the feed can narrow to bookable ones.
    useEffect(() => {
        if (!searchDate) { setOpeningsMap(null); return; }
        let stale = false;
        providerMarketService.searchProviders({ date: searchDate, ...(searchTime && { time: searchTime }) })
            .then(res => {
                if (stale) return;
                const map = {};
                (res.data.data || []).forEach(r => { map[r.provider] = r; });
                setOpeningsMap(map);
            })
            .catch(() => { if (!stale) setOpeningsMap(null); });
        return () => { stale = true; };
    }, [searchDate, searchTime]);

    // "Near me" → resolve the visitor's town once (OSM), then filter by it.
    const handleNearMe = () => {
        if (!navigator.geolocation) return;
        setNearMeLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const { latitude, longitude } = pos.coords;
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`, { headers: { 'Accept-Language': 'en' } });
                    const data = await res.json();
                    const city = data.address?.city || data.address?.town || data.address?.village || data.address?.state || '';
                    setNearMeCity(city);
                    setSearchLoc(city);
                } catch { /* leave filters unchanged */ } finally { setNearMeLoading(false); }
            },
            () => setNearMeLoading(false),
            { timeout: 8000 }
        );
    };

    // Key on the user ID, not the whole user object: a token refresh replaces the
    // user object reference, and re-loading favorites then would clobber a like the
    // user just made but that hasn't finished saving — so the like "goes away".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!user) { setFavorites([]); return; }
        favoriteService.list()
            .then(res => setFavorites((res.data.data || []).map(String)))
            .catch(() => {});
    }, [user?._id, user?.id]);

    // "Book again" — the user's own booking history powers one-tap rebooks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!user) { setMyAppointments([]); return; }
        appointmentService.getCustomerAppointments()
            .then(res => setMyAppointments(res.data.data || []))
            .catch(() => {});
    }, [user?._id, user?.id]);

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
                    currency: provObj?.currency || 'NAD',
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

    // One heart = private save + public like. We keep the optimistic like as a DELTA
    // overlay ({[id]: +/-n}) instead of mutating the providers array. Mutating providers
    // would re-run the likes-based sort memos (Discover/Recommended), physically
    // reordering the card under the user's finger — and reused image DOM nodes would then
    // show a neighbouring business's photo. The delta keeps counts live without reordering.
    const [likeDelta, setLikeDelta] = useState({});
    const bumpLike = (id, delta) => setLikeDelta(prev => ({ ...prev, [id]: (prev[id] || 0) + delta }));
    const likeCountFor = (p) => Math.max(0, (p.likesCount || 0) + (likeDelta[String(p._id)] || 0));

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

    // Desktop "Recommended" — every business exactly once. Businesses already shown
    // in "Recently viewed" are excluded so the page never repeats a card just to
    // fill space; ranking reuses the Discover score (rating first, small like boost).
    const recommendedProviders = useMemo(() => {
        const shown = new Set(recentlyViewed.map(p => String(p._id)));
        return discoverFeed.filter(p => !shown.has(String(p._id)));
    }, [discoverFeed, recentlyViewed]);

    // Distinct business categories → the filter chips ("All" + each category).
    const allCategories = useMemo(
        () => [...new Set(providers.map(p => p.providerCategory).filter(Boolean))].sort(),
        [providers]
    );

    // Any filter that should narrow the feed (and swap the desktop sections for results).
    const hasActiveFilter = !!(query.trim() || activeCategory || searchLoc || searchDate);

    // The feed = the ranked list, narrowed by the active search / category / location /
    // availability filters. This replaced the separate /services results page.
    const filteredProviders = useMemo(() => {
        let result = discoverFeed;
        const q = query.trim().toLowerCase();
        if (q) result = result.filter(p =>
            (p.businessName || p.name || '').toLowerCase().includes(q) ||
            (p.location || '').toLowerCase().includes(q) ||
            (p.providerCategory || '').toLowerCase().includes(q) ||
            (serviceNamesByProvider.get(String(p._id)) || []).some(name => name.includes(q))
        );
        if (activeCategory) result = result.filter(p => p.providerCategory === activeCategory);
        if (searchLoc) result = result.filter(p => (p.location || '').toLowerCase().includes(searchLoc.toLowerCase()));
        if (openingsMap) result = result.filter(p => openingsMap[p._id]);
        return result;
    }, [discoverFeed, query, activeCategory, searchLoc, openingsMap, serviceNamesByProvider]);

    // Infinite scroll: reveal the feed in chunks and pull in more as a sentinel near the
    // bottom scrolls into view — no pagination, no "next page" buttons.
    const PAGE = 6;
    const [visibleCount, setVisibleCount] = useState(PAGE);
    const sentinelRef = useRef(null);
    const hasMore = visibleCount < filteredProviders.length;

    useEffect(() => { setVisibleCount(PAGE); }, [filteredProviders]);

    useEffect(() => {
        const el = sentinelRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + PAGE, filteredProviders.length)); },
            { rootMargin: '700px 0px' }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [filteredProviders.length, loading]);

    // Search filters the feed in place (no navigation) — the results ARE the home now.
    const handleSearch = (e) => { e.preventDefault(); };

    // Clear every active filter and return to the default feed.
    const clearFilters = () => {
        setQuery(''); setActiveCategory(''); setSearchLoc(''); setNearMeCity('');
        setSearchDate(''); setSearchTime('');
    };

    return (
        <div style={{ background: 'var(--off-white)', paddingTop: 'var(--page-hero-pad-top)' }}>
            <Seo
                title="Bookplus — Book trusted local services"
                description="Discover and book trusted local businesses — hair, beauty, barbers, wellness, automotive and more. Real-time availability and instant confirmation."
                url={typeof window !== 'undefined' ? window.location.origin + '/' : 'https://www.bookplus.pro/'}
            />

            {/* Hero tagline lives on the boot splash now — the home opens straight
                into search + the discover feed (no top hero block). */}

            {/* ── Sticky search — sits under the navbar and settles as the feed scrolls ── */}
            <div ref={searchWrapRef} style={{
                position: 'sticky', top: 'calc(56px + var(--safe-top, 0px))', zIndex: 100,
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
                            placeholder="Search services or businesses"
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
                        <button type="submit" aria-label="Search" className="btn-primary" style={{ borderRadius: '50%', width: '46px', height: '46px', padding: 0, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ArrowRight size={21} strokeWidth={2.5} />
                        </button>
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

            {/* ── Filters — Near me + category pills. Narrow the feed in place. ── */}
            <div className="container" style={{ paddingTop: '0.9rem' }}>
                <div className="home-filter-row" style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.35rem', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    <button
                        type="button"
                        className="pressable"
                        // e.detail is 0 for keyboard-triggered clicks: blur on a pointer
                        // tap so no focus ring lingers on the pill, but keep the ring for
                        // keyboard users (who need it).
                        onClick={(e) => { if (e.detail) e.currentTarget.blur(); handleNearMe(); }}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', flexShrink: 0, minHeight: '44px', padding: '0.5rem 0.95rem', borderRadius: '999px', border: `1px solid ${nearMeCity ? 'var(--gold)' : 'var(--border)'}`, background: nearMeCity ? 'rgba(240,62,22,0.10)' : 'var(--card-bg)', color: nearMeCity ? 'var(--gold-dark)' : 'var(--charcoal)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-sm)' }}
                    >
                        <MapPin size={15} strokeWidth={2} /> {nearMeLoading ? 'Locating…' : (nearMeCity || 'Near me')}
                    </button>
                    {['', ...allCategories].map(cat => {
                        const active = activeCategory === cat;
                        return (
                            <button
                                key={cat || 'all'}
                                type="button"
                                className="pressable"
                                // blur on pointer tap (e.detail>0) so the active pill is a
                                // clean chip, not one wearing a lingering focus ring; keyboard
                                // clicks (e.detail===0) keep the ring for a11y.
                                onClick={(e) => { if (e.detail) e.currentTarget.blur(); setActiveCategory(cat); }}
                                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, minHeight: '44px', padding: '0.5rem 0.95rem', borderRadius: '999px', border: `1px solid ${active ? 'var(--charcoal)' : 'var(--border)'}`, background: active ? 'var(--charcoal)' : 'var(--card-bg)', color: active ? 'var(--off-white)' : 'var(--charcoal)', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow-sm)' }}
                            >
                                {cat || 'All'}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Desktop: Fresha-style sections (hidden on mobile). One card style
                 (compact photo card) and each business appears at most once across
                 the browse sections — no repeating businesses to fill the screen. ── */}
            <section className="home-sections-desktop" style={{ paddingTop: '0.75rem', paddingBottom: '3rem' }}>
                <div className="container">
                    {hasActiveFilter ? (
                        <>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 1.1rem' }}>
                                {filteredProviders.length} {filteredProviders.length === 1 ? 'business' : 'businesses'}{activeCategory ? ` · ${activeCategory}` : ''}
                            </h2>
                            {filteredProviders.length === 0 ? (
                                <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                    <p style={{ margin: '0 0 0.85rem', fontSize: '0.95rem' }}>No businesses match your filters.</p>
                                    <button onClick={clearFilters} className="btn-outline" style={{ padding: '0.5rem 1.25rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700 }}>Clear filters</button>
                                </div>
                            ) : (
                                <div className="home-section-grid">
                                    {filteredProviders.map(p => (
                                        <ProviderCard key={`res-${p._id}`} p={p} isFav={favSet.has(String(p._id))} onToggleFav={toggleFav} />
                                    ))}
                                </div>
                            )}
                        </>
                    ) : (
                      <>
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
                                            <p style={{ margin: '2px 0 0.7rem', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currencySymbol(item.currency)} {item.price} · {item.serviceName}</p>
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
                                    <ProviderCard key={`recent-${x._id}`} p={x} isFav={favSet.has(String(x._id))} onToggleFav={toggleFav} />
                                ))}
                            </div>
                        </div>
                    )}

                    {!loading && providers.length === 0 && (
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <p style={{ margin: 0, fontSize: '0.95rem' }}>New businesses are joining soon. Check back shortly.</p>
                        </div>
                    )}
                    {/* Recommended — every remaining business, exactly once */}
                    {!loading && recommendedProviders.length > 0 && (
                        <div style={{ marginBottom: '2.75rem' }}>
                            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.55rem', fontWeight: 700, color: 'var(--charcoal)', margin: '0 0 0.25rem' }}>Recommended</h2>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: '0 0 1.1rem' }}>Businesses picked for you</p>
                            <div className="home-section-grid">
                                {recommendedProviders.map(x => (
                                    <ProviderCard key={`rec-${x._id}`} p={x} isFav={favSet.has(String(x._id))} onToggleFav={toggleFav} />
                                ))}
                            </div>
                        </div>
                    )}
                      </>
                    )}
                </div>
            </section>

            {/* ── Discover feed (vertical, photo-rich) — the primary MOBILE home feed ── */}
            <section className="home-feed-mobile" style={{ paddingTop: '0.5rem', paddingBottom: '3.5rem' }}>
                <div className="container">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>
                        {hasActiveFilter ? `${filteredProviders.length} ${filteredProviders.length === 1 ? 'result' : 'results'}` : 'Discover'}
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>
                        {hasActiveFilter
                            ? <>Matching your search{activeCategory ? ` · ${activeCategory}` : ''}. <button onClick={clearFilters} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--gold-dark)', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.9rem' }}>Clear</button></>
                            : 'Browse businesses near you — swipe their photos, tap to book.'}
                    </p>
                    <div className="discover-feed">
                        {loading ? (
                            [0, 1, 2].map(i => (
                                <div key={i} style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                    <div style={{ aspectRatio: '1 / 1', background: 'var(--warm-gray)' }} />
                                    <div style={{ padding: '0.85rem 1.1rem 1.05rem' }}>
                                        <div style={{ height: '14px', width: '60%', background: 'var(--warm-gray)', borderRadius: '6px', marginBottom: '8px' }} />
                                        <div style={{ height: '10px', width: '40%', background: 'var(--warm-gray)', borderRadius: '6px' }} />
                                    </div>
                                </div>
                            ))
                        ) : filteredProviders.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <p style={{ margin: hasActiveFilter ? '0 0 0.85rem' : 0, fontSize: '0.95rem' }}>
                                    {hasActiveFilter ? 'No businesses match your filters.' : 'New businesses are joining soon. Check back shortly.'}
                                </p>
                                {hasActiveFilter && <button onClick={clearFilters} className="btn-outline" style={{ padding: '0.5rem 1.25rem', borderRadius: '999px', fontSize: '0.85rem', fontWeight: 700 }}>Clear filters</button>}
                            </div>
                        ) : (
                            <>
                                {filteredProviders.slice(0, visibleCount).map(p => (
                                    <FeedCard key={p._id} p={p} isFav={favSet.has(String(p._id))} likeCount={likeCountFor(p)} onToggleFav={toggleFav} />
                                ))}
                                {hasMore && (
                                    // Shaped skeleton (not a bare spinner) so the incoming card's
                                    // space is reserved and matches the initial-load placeholder.
                                    <div ref={sentinelRef} style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                        <div className="skeleton" style={{ aspectRatio: '1 / 1' }} />
                                        <div style={{ padding: '0.85rem 1.1rem 1.05rem' }}>
                                            <div className="skeleton skeleton-line" style={{ width: '60%' }} />
                                            <div className="skeleton skeleton-line" style={{ width: '40%', marginBottom: 0 }} />
                                        </div>
                                    </div>
                                )}
                                {!hasMore && filteredProviders.length > PAGE && (
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
                    {user?.role === 'provider' ? (
                        /* The dashboard lives in the business app — a hard navigation, not a
                           react-router Link (the customer app has no /dashboard route). */
                        <a href={`${BUSINESS_URL}/dashboard`} className="btn-primary" style={{ fontSize: '0.9rem', padding: '0.6rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            Go to dashboard <ArrowRight size={16} strokeWidth={2} />
                        </a>
                    ) : (
                        <Link to={user ? '/book-appointment' : '/register'} className="btn-primary" style={{ fontSize: '0.9rem', padding: '0.6rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                            {user ? 'Book an appointment' : 'Get started'} <ArrowRight size={16} strokeWidth={2} />
                        </Link>
                    )}
                </div>
            </section>
        </div>
    );
};

export default Home;
