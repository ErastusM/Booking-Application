import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { providerMarketService } from '../services';

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : '#e2e0db', fontSize: '0.85rem' }}>★</span>
        ))}
    </div>
);

const ProvidersPage = () => {
    const [providers, setProviders] = useState([]);
    const [filtered, setFiltered] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [locationFilter, setLocationFilter] = useState('');
    const navigate = useNavigate();

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
                p.name.toLowerCase().includes(search.toLowerCase()) ||
                p.location?.toLowerCase().includes(search.toLowerCase())
            );
        }
        if (locationFilter) {
            result = result.filter(p =>
                p.location?.toLowerCase().includes(locationFilter.toLowerCase())
            );
        }
        setFiltered(result);
    }, [search, locationFilter, providers]);

    const allLocations = [...new Set(providers.map(p => p.location).filter(Boolean))];

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Finding providers...</p>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Header */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '4rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 80% 50%, rgba(201,168,76,0.08) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: '600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Discover</p>
                    <h1 style={{ fontFamily: 'Inter, sans-serif', fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: '700', color: 'white', marginBottom: '2rem' }}>
                        Find Your Provider
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
                                    fontSize: '0.95rem', fontFamily: 'Inter, sans-serif',
                                    outline: 'none', background: 'white',
                                    boxShadow: 'var(--shadow-md)',
                                }}
                            />
                        </div>
                        <div style={{ flex: 1, minWidth: '160px' }}>
                            <select
                                value={locationFilter}
                                onChange={e => setLocationFilter(e.target.value)}
                                style={{
                                    width: '100%', padding: '0.875rem 1rem',
                                    border: 'none', borderRadius: 'var(--radius-sm)',
                                    fontSize: '0.95rem', fontFamily: 'Inter, sans-serif',
                                    outline: 'none', background: 'white',
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
                    </div>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>

                {/* Results count */}
                <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                    {filtered.length} provider{filtered.length !== 1 ? 's' : ''} found
                    {search && ` for "${search}"`}
                    {locationFilter && ` in ${locationFilter}`}
                </p>

                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '5rem 2rem', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💈</div>
                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', color: 'var(--charcoal)', marginBottom: '0.5rem' }}>No providers found</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Try adjusting your search or location filter</p>
                    </div>
                ) : (
                    <div className="providers-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {filtered.map((provider, i) => (
                            <div
                                key={provider._id}
                                className="fade-up"
                                style={{ animationDelay: `${i * 0.06}s`, opacity: 0 }}
                                onClick={() => navigate(`/providers/${provider._id}`)}
                            >
                                <div style={{
                                    background: 'white', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
                                    overflow: 'hidden', cursor: 'pointer',
                                    transition: 'box-shadow 0.2s ease, transform 0.2s ease',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-4px)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; }}
                                >
                                    {/* Cover */}
                                    <div style={{ height: '140px', background: 'linear-gradient(135deg, var(--charcoal) 0%, var(--charcoal-light) 100%)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(201,168,76,0.15) 0%, transparent 60%)' }} />
                                        {provider.avatar ? (
                                            <img src={provider.avatar} alt={provider.name} style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', position: 'relative', zIndex: 1 }} />
                                        ) : (
                                            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif', fontSize: '2rem', fontWeight: '700', color: 'var(--charcoal)', border: '3px solid rgba(255,255,255,0.2)', position: 'relative', zIndex: 1 }}>
                                                {getInitials(provider.name)}
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ padding: '1.25rem' }}>
                                        <h3 style={{ fontFamily: 'Inter, sans-serif', fontSize: '1.15rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>{provider.name}</h3>

                                        {provider.providerCategory && (
                                            <span style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: '600', padding: '0.2rem 0.6rem', borderRadius: '99px', background: 'rgba(201,168,76,0.1)', color: 'var(--gold-dark)', border: '1px solid rgba(201,168,76,0.3)', marginBottom: '0.5rem' }}>
                                                {provider.providerCategory}
                                            </span>
                                        )}
                                        {provider.location && (
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                                                📍 {provider.location}
                                            </p>
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

                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.875rem', borderTop: '1px solid var(--border)' }}>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                {provider.serviceCount} service{provider.serviceCount !== 1 ? 's' : ''}
                                            </span>
                                            {provider.minPrice !== null && (
                                                <span style={{ fontSize: '0.875rem', fontWeight: '600', color: 'var(--charcoal)' }}>
                                                    from ${provider.minPrice}
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