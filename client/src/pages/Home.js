import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthContext } from '../context/AuthContext';
import { providerMarketService, favoriteService } from '../services';
import { Search, Star, ShieldCheck, CalendarCheck, Clock, Zap, ArrowRight, Heart } from 'lucide-react';
import { cloudinaryThumb } from '../utils/cloudinary';

const features = [
    { Icon: ShieldCheck, title: 'Trusted professionals', description: 'Top-rated providers across beauty, wellness, automotive, training and more.' },
    { Icon: CalendarCheck, title: 'Book in seconds', description: 'Pick a time and confirm instantly — no phone calls, no waiting rooms.' },
    { Icon: Clock, title: 'On your schedule', description: 'Early mornings or late evenings, find a slot that fits your day.' },
    { Icon: Zap, title: 'Instant confirmation', description: 'Real-time confirmations and reminders, straight to your inbox.' },
];

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
                    ? <img src={cloudinaryThumb(cover, 600, 450)} alt={p.businessName || p.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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

    const toggleFav = async (e, id) => {
        e.preventDefault();
        e.stopPropagation();
        if (!user) { navigate('/login'); return; }
        setFavorites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        try {
            const res = await favoriteService.toggle(id);
            setFavorites((res.data.data || []).map(String));
        } catch {
            favoriteService.list().then(r => setFavorites((r.data.data || []).map(String))).catch(() => {});
        }
    };

    const sections = useMemo(() => {
        const featured = [...providers].filter(p => p.avgRating).sort((a, b) => b.avgRating - a.avgRating).slice(0, 10);
        const newest = [...providers].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 10);
        const trending = [...providers].filter(p => p.reviewCount > 0).sort((a, b) => b.reviewCount - a.reviewCount).slice(0, 10);
        const saved = providers.filter(p => favSet.has(String(p._id)));
        return { saved, featured, newest, trending };
    }, [providers, favSet]);

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

            {/* ── Discovery feed ── */}
            <section style={{ paddingBottom: '3.5rem' }}>
                <div className="container">
                    {loading ? (
                        <div style={{ display: 'flex', gap: '1rem', overflow: 'hidden' }}>
                            {[0, 1, 2, 3, 4].map(i => (
                                <div key={i} style={{ flex: '0 0 200px' }}>
                                    <div style={{ height: '140px', background: 'var(--warm-gray)', borderRadius: 'var(--radius-lg, 16px)', marginBottom: '0.6rem' }} />
                                    <div style={{ height: '12px', width: '70%', background: 'var(--warm-gray)', borderRadius: '6px', marginBottom: '8px' }} />
                                    <div style={{ height: '10px', width: '45%', background: 'var(--warm-gray)', borderRadius: '6px' }} />
                                </div>
                            ))}
                        </div>
                    ) : providers.length === 0 ? (
                        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <p style={{ margin: 0, fontSize: '0.95rem' }}>New providers are joining soon. Check back shortly.</p>
                        </div>
                    ) : (
                        [
                            { title: 'Saved', items: sections.saved, badge: null },
                            { title: 'Featured', items: sections.featured, badge: 'Featured' },
                            { title: 'New on Bookplus', items: sections.newest, badge: 'New' },
                            { title: 'Trending', items: sections.trending, badge: null },
                        ].filter(row => row.items.length > 0).map(row => (
                            <div key={row.title} style={{ marginBottom: '2.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem' }}>
                                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.4rem, 3vw, 1.9rem)', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>{row.title}</h2>
                                    <Link to="/services" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--gold-dark)', fontWeight: '600', fontSize: '0.9rem', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                        View all <ArrowRight size={15} strokeWidth={2} />
                                    </Link>
                                </div>
                                <div className="discovery-row">
                                    {row.items.map(p => (
                                        <ProviderCard key={p._id} p={p} badge={row.badge} isFav={favSet.has(String(p._id))} onToggleFav={toggleFav} />
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            {/* ── Why Bookplus ── */}
            <section style={{ background: 'var(--card-bg)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: 'clamp(3rem, 7vh, 5rem) 0' }}>
                <div className="container">
                    <div style={{ textAlign: 'center', marginBottom: '2.75rem' }}>
                        <p style={{ color: 'var(--gold-dark)', fontSize: '0.78rem', fontWeight: '700', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Why Bookplus</p>
                        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem, 4vw, 2.6rem)', fontWeight: '700', color: 'var(--charcoal)', margin: 0 }}>Booking, done beautifully</h2>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '1.25rem' }}>
                        {features.map(({ Icon, title, description }, i) => (
                            <div key={i} style={{ background: 'var(--off-white)', borderRadius: 'var(--radius-lg, 18px)', border: '1px solid var(--border)', padding: '1.75rem' }}>
                                <div style={{ width: '46px', height: '46px', borderRadius: '12px', background: 'rgba(201,168,76,0.12)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.1rem' }}>
                                    <Icon size={22} strokeWidth={2} />
                                </div>
                                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', margin: '0 0 0.5rem' }}>{title}</h3>
                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }}>{description}</p>
                            </div>
                        ))}
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
