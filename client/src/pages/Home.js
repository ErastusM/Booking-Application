import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { providerMarketService, favoriteService } from '../services';
import { Search, Star, ArrowRight, Heart, MapPin } from 'lucide-react';
import { cloudinaryThumb } from '../utils/cloudinary';

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
            <div className="home-provider-card__media" style={{ position: 'relative', aspectRatio: '4 / 3', borderRadius: '16px', overflow: 'hidden', background: cover ? 'var(--warm-gray)' : 'linear-gradient(135deg, #2a2a44 0%, #1a1a2e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow-sm)' }}>
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
                            <Star size={13} fill="#c9a84c" strokeWidth={0} /> {p.avgRating}
                        </span>
                    )}
                </div>
            </div>
        </Link>
    );
};

// Full-width, photo-rich card for the vertical "Discover" feed. The photo carousel owns
// the horizontal axis here (the feed scrolls vertically), so per-card swipe works cleanly.
const FeedCard = ({ p, isFav, likeCount, onToggleFav }) => {
    // Cap the swipeable gallery at five photos — keeps the carousel tight and matches
    // the "five business photos" spec for the discovery card.
    const photos = ((p.photos && p.photos.length) ? p.photos : (p.coverImage ? [p.coverImage] : [])).slice(0, 5);
    const initial = (p.businessName || p.name || '?').charAt(0).toUpperCase();
    const loc = p.location || p.businessProfile?.address || 'Namibia';
    return (
        <Link to={`/providers/${p._id}`} style={{ display: 'block', textDecoration: 'none', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '18px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ position: 'relative' }}>
                {photos.length > 0 ? (
                    <div className="feed-carousel" style={{ display: 'flex', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
                        {photos.map((src, i) => (
                            <img key={i} src={cloudinaryThumb(src, 900)} alt={`${p.businessName || p.name} photo ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" style={{ flex: '0 0 100%', width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', scrollSnapAlign: 'start', display: 'block', background: 'var(--warm-gray)' }} />
                        ))}
                    </div>
                ) : (
                    <div style={{ aspectRatio: '4 / 3', background: 'linear-gradient(135deg, #2a2a44 0%, #1a1a2e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', fontWeight: '700', color: 'var(--gold)' }}>{initial}</span>
                    </div>
                )}
                {photos.length > 1 && (
                    <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '5px', pointerEvents: 'none' }}>
                        {photos.map((_, i) => <span key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.9)', boxShadow: '0 1px 2px rgba(0,0,0,0.35)' }} />)}
                    </div>
                )}
                <button
                    type="button"
                    aria-label={isFav ? 'Unlike' : 'Like'}
                    onClick={(e) => onToggleFav(e, String(p._id))}
                    style={{ position: 'absolute', top: '12px', right: '12px', display: 'inline-flex', alignItems: 'center', gap: '5px', border: 'none', background: 'rgba(255,255,255,0.95)', borderRadius: '999px', padding: '6px 11px', cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.2)' }}
                >
                    <Heart size={17} strokeWidth={2} fill={isFav ? '#e0245e' : 'none'} color={isFav ? '#e0245e' : '#52525b'} />
                    {likeCount > 0 && <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--charcoal)' }}>{likeCount}</span>}
                </button>
            </div>
            <div style={{ padding: '0.85rem 1.1rem 1.05rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <p style={{ fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--charcoal)', fontSize: '1.05rem', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.businessName || p.name}</p>
                    {p.avgRating && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.85rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0 }}>
                            <Star size={14} fill="#c9a84c" strokeWidth={0} /> {p.avgRating}
                            <span style={{ color: 'var(--text-muted)', fontWeight: '500' }}>({p.reviewCount || 0})</span>
                        </span>
                    )}
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <MapPin size={13} style={{ flexShrink: 0 }} /> {loc}{p.providerCategory ? ` · ${p.providerCategory}` : ''}
                </p>
            </div>
        </Link>
    );
};

const Home = () => {
    const { user } = useAuthContext();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [providers, setProviders] = useState([]);
    const [favorites, setFavorites] = useState([]);
    const [loading, setLoading] = useState(true);

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

    const handleSearch = (e) => {
        e.preventDefault();
        navigate(query.trim() ? `/services?q=${encodeURIComponent(query.trim())}` : '/services');
    };

    return (
        <div style={{ background: 'var(--off-white)' }}>

            {/* ── Hero ── */}
            <section style={{ position: 'relative', overflow: 'hidden', background: 'var(--off-white)', paddingTop: 'clamp(7rem, 15vh, 11rem)', paddingBottom: 'clamp(2.5rem, 6vh, 4.5rem)' }}>
                <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'radial-gradient(62% 48% at 50% -2%, rgba(201,168,76,0.16), transparent 72%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative', textAlign: 'center', maxWidth: '860px', marginLeft: 'auto', marginRight: 'auto' }}>
                    <p className="fade-up" style={{ color: 'var(--gold-dark)', fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '1.1rem' }}>Premium booking, simplified</p>
                    <h1 className="fade-up fade-up-delay-1" style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.6rem, 6.2vw, 4.6rem)', fontWeight: '700', color: 'var(--charcoal)', lineHeight: 1.05, letterSpacing: '-0.02em', margin: '0 0 1.25rem' }}>
                        Book trusted <span style={{ color: 'var(--gold)' }}>local services</span>
                    </h1>
                    <p className="fade-up fade-up-delay-2" style={{ color: 'var(--text-secondary)', fontSize: 'clamp(1rem, 2vw, 1.2rem)', lineHeight: 1.65, maxWidth: '620px', margin: '0 auto 2rem' }}>
                        Discover top-rated providers for beauty, wellness, automotive, training and more — booked in seconds, on your schedule.
                    </p>

                    {/* Search */}
                    <form onSubmit={handleSearch} className="fade-up fade-up-delay-3" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: '999px', padding: '0.4rem 0.4rem 0.4rem 1.25rem', boxShadow: '0 10px 34px rgba(26,26,46,0.12)', maxWidth: '560px', margin: '0 auto' }}>
                        <Search size={19} strokeWidth={2} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search services or providers…"
                            aria-label="Search services or providers"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: '1rem', color: 'var(--charcoal)', fontFamily: 'var(--font-body)' }}
                        />
                        <button type="submit" className="btn-primary" style={{ borderRadius: '999px', padding: '0.7rem 1.6rem', flexShrink: 0 }}>Search</button>
                    </form>

                    {/* Social proof */}
                    <div className="fade-up fade-up-delay-3" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        <span style={{ display: 'inline-flex', gap: '1px' }}>
                            {[0, 1, 2, 3, 4].map(i => <Star key={i} size={14} fill="#c9a84c" strokeWidth={0} />)}
                        </span>
                        Loved by clients across Namibia
                    </div>
                </div>
            </section>

            {/* ── Discover feed (vertical, photo-rich) — the primary home feed ── */}
            <section style={{ paddingTop: '0.5rem', paddingBottom: '3.5rem' }}>
                <div className="container">
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.4rem' }}>Discover</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '0 0 1.5rem' }}>Browse businesses near you — swipe their photos, tap to book.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '540px', margin: '0 auto' }}>
                        {loading ? (
                            [0, 1, 2].map(i => (
                                <div key={i} style={{ borderRadius: '18px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                    <div style={{ aspectRatio: '4 / 3', background: 'var(--warm-gray)' }} />
                                    <div style={{ padding: '0.85rem 1.1rem 1.05rem' }}>
                                        <div style={{ height: '14px', width: '60%', background: 'var(--warm-gray)', borderRadius: '6px', marginBottom: '8px' }} />
                                        <div style={{ height: '10px', width: '40%', background: 'var(--warm-gray)', borderRadius: '6px' }} />
                                    </div>
                                </div>
                            ))
                        ) : providers.length === 0 ? (
                            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                <p style={{ margin: 0, fontSize: '0.95rem' }}>New providers are joining soon. Check back shortly.</p>
                            </div>
                        ) : (
                            discoverFeed.map(p => (
                                <FeedCard key={p._id} p={p} isFav={favSet.has(String(p._id))} likeCount={p.likesCount || 0} onToggleFav={toggleFav} />
                            ))
                        )}
                    </div>
                </div>
            </section>


            {/* ── CTA ── */}
            <section style={{ background: 'var(--ink)', padding: 'clamp(3.5rem, 8vh, 6rem) 0', position: 'relative', overflow: 'hidden' }}>
                <div aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 50%, rgba(201,168,76,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative', textAlign: 'center', maxWidth: '640px' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: '700', color: 'white', margin: '0 0 1rem' }}>
                        {user?.role === 'provider' ? 'Grow your business with Bookplus' : 'Ready when you are'}
                    </h2>
                    <p style={{ color: 'rgba(255,255,255,0.62)', fontSize: '1.02rem', lineHeight: 1.6, margin: '0 0 2rem' }}>
                        {user?.role === 'provider'
                            ? 'Manage your calendar, clients and bookings from one elegant workspace.'
                            : 'Find a provider, pick a time, and you’re booked. It’s that simple.'}
                    </p>
                    <Link to={user ? (user.role === 'provider' ? '/dashboard' : '/services') : '/register'} className="btn-primary" style={{ fontSize: '1rem', padding: '0.9rem 2.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        {user ? (user.role === 'provider' ? 'Go to dashboard' : 'Browse providers') : 'Get started'} <ArrowRight size={18} strokeWidth={2} />
                    </Link>
                </div>
            </section>

            {/* ── Footer ── */}
            <footer style={{ background: '#111122', padding: '2rem 0', borderTop: '1px solid rgba(201,168,76,0.15)' }}>
                <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: '700', color: 'white' }}>Book<span style={{ color: 'var(--gold)' }}>plus</span></span>
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>© {new Date().getFullYear()} Bookplus. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
};

export default Home;
