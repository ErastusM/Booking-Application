import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { providerMarketService } from '../services';
import { cloudinaryAvatar } from '../utils/cloudinary';
import { mapsUrl } from '../utils/maps';
import { normalizeTown } from '../utils/namibiaTowns';

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : '#d3d5d4', fontSize: '0.85rem' }}>★</span>
        ))}
    </div>
);

const ProvidersPage = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const dateFilter = searchParams.get('date') || '';
    const timeFilter = searchParams.get('time') || '';
    const [providers, setProviders] = useState([]);
    const [filtered, setFiltered] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState(searchParams.get('q') || '');
    const [locationFilter, setLocationFilter] = useState(searchParams.get('loc') || '');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [nearMeLoading, setNearMeLoading] = useState(false);
    const [nearMeCity, setNearMeCity] = useState(null);
    // providerId → { openings: ['09:00', …] } when a date filter is active;
    // null = not asked / failed (fail open: show everyone, no chips).
    const [openingsMap, setOpeningsMap] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        if (!dateFilter) { setOpeningsMap(null); return; }
        let stale = false;
        providerMarketService.searchProviders({ date: dateFilter, ...(timeFilter && { time: timeFilter }) })
            .then(res => {
                if (stale) return;
                const map = {};
                (res.data.data || []).forEach(r => { map[r.provider] = r; });
                setOpeningsMap(map);
            })
            .catch(() => { if (!stale) setOpeningsMap(null); });
        return () => { stale = true; };
    }, [dateFilter, timeFilter]);

    const clearDateFilter = () => {
        const next = new URLSearchParams(searchParams);
        next.delete('date');
        next.delete('time');
        setSearchParams(next, { replace: true });
    };

    const handleNearMe = () => {
        if (!navigator.geolocation) return;
        setNearMeLoading(true);
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const { latitude, longitude } = pos.coords;
                    const res = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
                        { headers: { 'Accept-Language': 'en' } }
                    );
                    const data = await res.json();
                    const city = data.address?.city || data.address?.town || data.address?.village || data.address?.state || '';
                    setNearMeCity(city);
                    setLocationFilter(city);
                } catch {
                    // Silently fail — leave filters unchanged
                } finally {
                    setNearMeLoading(false);
                }
            },
            () => setNearMeLoading(false),
            { timeout: 8000 }
        );
    };

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await providerMarketService.getAllProviders();
                setProviders(res.data.data);
                setFiltered(res.data.data);
            } catch {
                // silently fail
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    useEffect(() => {
        let result = providers;
        if (search) {
            result = result.filter(p =>
                (p.businessName || p.name).toLowerCase().includes(search.toLowerCase()) ||
                p.location?.toLowerCase().includes(search.toLowerCase())
            );
        }
        if (locationFilter) {
            result = result.filter(p =>
                p.location?.toLowerCase().includes(locationFilter.toLowerCase())
            );
        }
        if (categoryFilter) {
            result = result.filter(p => p.providerCategory === categoryFilter);
        }
        if (openingsMap) {
            // Availability-first: only businesses with a real opening, soonest first.
            result = result
                .filter(p => openingsMap[p._id])
                .sort((a, b) => openingsMap[a._id].openings[0].localeCompare(openingsMap[b._id].openings[0]));
        }
        setFiltered(result);
    }, [search, locationFilter, categoryFilter, providers, openingsMap]);

    const allLocations = [...new Set(providers.map(p => p.location).filter(Boolean))];
    const allCategories = [...new Set(providers.map(p => p.providerCategory).filter(Boolean))].sort();

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    if (loading) return (
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Finding businesses...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* Header */}
            <div style={{ background: 'var(--ink)', paddingTop: 'var(--page-hero-pad-top)', paddingBottom: '4rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 50%, rgba(240,62,22,0.045) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Discover</p>
                    <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: '700', color: 'white', marginBottom: '2rem' }}>
                        Find a Business
                    </h1>

                    {/* Search bar */}
                    <div className="providers-search-filters" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', maxWidth: '700px' }}>
                        <div style={{ flex: 2, position: 'relative', minWidth: '200px' }}>
                            <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '1rem' }}>🔍</span>
                            <input
                                type="text"
                                placeholder="Search by name or service..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                style={{
                                    width: '100%', padding: '0.875rem 1rem 0.875rem 2.75rem',
                                    border: 'none', borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.95rem', fontFamily: 'var(--font-body)',
                                    outline: 'none', background: 'var(--card-bg)',
                                    boxShadow: 'var(--shadow-md)',
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: '160px' }}>
                            <select
                                value={locationFilter}
                                onChange={e => { setLocationFilter(e.target.value); setNearMeCity(null); }}
                                style={{
                                    width: '100%', padding: '0.875rem 1rem',
                                    border: 'none', borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.95rem', fontFamily: 'var(--font-body)',
                                    outline: 'none', background: 'var(--card-bg)',
                                    boxShadow: 'var(--shadow-md)', cursor: 'pointer',
                                    color: locationFilter ? 'var(--charcoal)' : 'var(--text-muted)',
                                }}
                            >
                                <option value="">📍 All locations</option>
                                {allLocations.map(loc => (
                                    <option key={loc} value={loc}>{loc}</option>
                                ))}
                            </select>
                        </div>
                        <button
                            onClick={handleNearMe}
                            disabled={nearMeLoading}
                            title="Find businesses near your current location"
                            style={{
                                padding: '0.875rem 1.25rem', border: 'none', borderRadius: 'var(--radius-sm)',
                                background: nearMeCity ? 'var(--gold)' : 'white', color: nearMeCity ? 'var(--charcoal)' : 'var(--text-muted)',
                                boxShadow: 'var(--shadow-md)', cursor: nearMeLoading ? 'not-allowed' : 'pointer',
                                fontFamily: 'var(--font-body)', fontSize: '0.875rem', fontWeight: '600',
                                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem',
                                opacity: nearMeLoading ? 0.7 : 1, transition: 'all 0.2s',
                            }}
                        >
                            {nearMeLoading ? (
                                <span style={{ display: 'inline-block', width: '14px', height: '14px', border: '2px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            ) : '📡'}
                            {nearMeCity ? nearMeCity : 'Near me'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>

                {/* Category filter chips */}
                {allCategories.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '1.5rem', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                        {['', ...allCategories].map(cat => {
                            const active = categoryFilter === cat;
                            return (
                                <button
                                    key={cat || 'all'}
                                    onClick={() => setCategoryFilter(cat)}
                                    style={{
                                        flexShrink: 0, padding: '0.45rem 1rem', borderRadius: '999px',
                                        border: '1px solid', borderColor: active ? 'var(--gold)' : 'var(--border)',
                                        background: active ? 'var(--ink)' : 'var(--card-bg)',
                                        color: active ? 'var(--on-ink, #fff)' : 'var(--text-secondary)',
                                        fontSize: '0.82rem', fontWeight: active ? '700' : '500', cursor: 'pointer',
                                        fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', transition: 'all 0.15s',
                                    }}
                                >
                                    {cat || 'All'}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Results count */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
                        {filtered.length} business{filtered.length !== 1 ? 'es' : ''} {openingsMap ? 'available' : 'found'}
                        {search && ` for "${search}"`}
                        {categoryFilter && ` in ${categoryFilter}`}
                        {locationFilter && ` near ${locationFilter}`}
                    </p>
                    {dateFilter && (
                        <button
                            onClick={clearDateFilter}
                            title="Clear the availability filter"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                padding: '0.3rem 0.75rem', borderRadius: '999px',
                                border: '1px solid rgba(240,62,22,0.3)', background: 'rgba(240,62,22,0.08)',
                                color: 'var(--gold-dark)', fontSize: '0.8rem', fontWeight: '600',
                                fontFamily: 'var(--font-body)', cursor: 'pointer',
                            }}
                        >
                            {new Date(`${dateFilter}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                            {timeFilter && ` · from ${timeFilter}`}
                            <span aria-hidden="true" style={{ fontSize: '0.9rem', lineHeight: 1 }}>×</span>
                        </button>
                    )}
                </div>

                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '5rem 2rem', background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💈</div>
                        <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>
                            {openingsMap ? 'No openings on that date' : 'No businesses found'}
                        </h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            {openingsMap ? 'Try another day or time, or clear the date filter above' : 'Try adjusting your search or location filter'}
                        </p>
                    </div>
                ) : (
                    <div className="providers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {filtered.map((provider, i) => (
                            <div
                                key={provider._id}
                                className="fade-up"
                                style={{ animationDelay: `${i * 0.06}s`, opacity: 0, height: '100%' }}
                                onClick={() => navigate(`/providers/${provider._id}`)}
                            >
                                <div style={{
                                    background: 'var(--card-bg)', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
                                    overflow: 'hidden', cursor: 'pointer', height: '100%',
                                    display: 'flex', flexDirection: 'column',
                                    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-4px)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                    {/* Cover */}
                                    <div style={{ height: '140px', background: 'linear-gradient(135deg, var(--charcoal) 0%, var(--charcoal-light) 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(240,62,22,0.15) 0%, transparent 60%)' }} />
                                        {provider.avatar ? (
                                            <img src={cloudinaryAvatar(provider.avatar)} alt={provider.name} style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', position: 'relative', zIndex: 1 }} />
                                        ) : (
                                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: '2rem', fontWeight: '700', color: 'var(--ink)', border: '3px solid rgba(255,255,255,0.2)', position: 'relative', zIndex: 1 }}>
                                                {getInitials(provider.name)}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: '700', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>{provider.businessName || provider.name}</h3>

                                        {provider.providerCategory && (
                                            <span style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', background: 'rgba(240,62,22,0.1)', color: 'var(--gold-dark)', border: '1px solid rgba(240,62,22,0.3)', marginBottom: '0.5rem' }}>
                                                {provider.providerCategory}
                                            </span>
                                        )}
                                        {provider.location && (
                                            <a href={mapsUrl(normalizeTown(provider.location))} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'flex-start', gap: '0.3rem', textDecoration: 'none' }}>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                                                <span style={{ textDecoration: 'underline' }}>{normalizeTown(provider.location)}</span>
                                            </a>
                                        )}

                                        {/* Rating */}
                                        {provider.avgRating ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                                <StarDisplay rating={parseFloat(provider.avgRating)} />
                                                <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--charcoal)' }}>{provider.avgRating}</span>
                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>({provider.reviewCount} review{provider.reviewCount !== 1 ? 's' : ''})</span>
                                            </div>
                                        ) : (
                                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>No reviews yet</p>
                                        )}

                                        {/* Real openings on the searched date */}
                                        {openingsMap?.[provider._id] && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                                                {openingsMap[provider._id].openings.map(t => (
                                                    <span key={t} style={{
                                                        padding: '0.22rem 0.6rem', borderRadius: '999px',
                                                        background: 'rgba(240,62,22,0.08)', border: '1px solid rgba(240,62,22,0.25)',
                                                        color: 'var(--gold-dark)', fontSize: '0.75rem', fontWeight: '700',
                                                    }}>{t}</span>
                                                ))}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.875rem', borderTop: '1px solid var(--border)', marginTop: 'auto' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {provider.serviceCount} service{provider.serviceCount !== 1 ? 's' : ''}
                                            </span>
                                            {provider.minPrice !== null && (
                                                <span style={{ fontSize: '0.875rem', fontWeight: '700', color: 'var(--gold-dark)' }}>
                                                    from NAD {provider.minPrice}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProvidersPage;