import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { providerMarketService } from '../services';
import { useAuthContext } from '../context/AuthContext';

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : '#e2e0db', fontSize: '0.9rem' }}>★</span>
        ))}
    </div>
);

const ProviderProfilePage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuthContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('featured');

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await providerMarketService.getProviderProfile(id);
                setData(res.data.data);
            } catch {
                navigate('/services');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [id]);

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';

    if (loading) return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: '40px', height: '40px', border: '3px solid var(--border)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    if (!data) return null;

    const { provider, categories, reviews } = data;
    const categoryKeys = Object.keys(categories);
    const activeServices = categories[activeCategory]?.services || [];

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Hero */}
            <div style={{ background: 'var(--charcoal)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 30% 60%, rgba(201,168,76,0.1) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <button onClick={() => navigate('/services')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'DM Sans, sans-serif', marginBottom: '1.5rem', padding: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        ← Back to Services
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                        {provider.avatar ? (
                            <img src={provider.avatar} alt={provider.name} style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', flexShrink: 0 }} />
                        ) : (
                            <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Playfair Display, serif', fontSize: '2.2rem', fontWeight: '700', color: 'var(--charcoal)', flexShrink: 0 }}>
                                {getInitials(provider.name)}
                            </div>
                        )}
                        <div>
                            <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: '700', color: 'white', marginBottom: '0.5rem' }}>
                                {provider.name}
                            </h1>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                {provider.avgRating && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <StarDisplay rating={parseFloat(provider.avgRating)} />
                                        <span style={{ color: 'white', fontWeight: '600', fontSize: '0.9rem' }}>{provider.avgRating}</span>
                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>({provider.reviewCount} reviews)</span>
                                    </div>
                                )}
                                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem' }}>
                                    {provider.serviceCount} service{provider.serviceCount !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '2rem', alignItems: 'start' }}>

                    {/* Left — services */}
                    <div>
                        {/* Category tabs */}
                        <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', overflowX: 'auto' }}>
                            {categoryKeys.map(key => {
                                const cat = categories[key];
                                if (cat.services.length === 0 && key !== 'featured') return null;
                                return (
                                    <button key={key} onClick={() => setActiveCategory(key)} style={{
                                        padding: '0.75rem 1.25rem', background: 'none', border: 'none',
                                        borderBottom: activeCategory === key ? '2px solid var(--gold)' : '2px solid transparent',
                                        color: activeCategory === key ? 'var(--gold-dark)' : 'var(--text-muted)',
                                        fontWeight: activeCategory === key ? '600' : '400',
                                        fontSize: '0.875rem', cursor: 'pointer',
                                        fontFamily: 'DM Sans, sans-serif', whiteSpace: 'nowrap',
                                        transition: 'all 0.2s', marginBottom: '-1px',
                                    }}>
                                        {cat.name}
                                        {cat.services.length > 0 && (
                                            <span style={{ marginLeft: '0.35rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                ({cat.services.length})
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Services list */}
                        {activeServices.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No services in this category yet</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {activeServices.map(service => (
                                    <div key={service._id} style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ flex: 1 }}>
                                            <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '0.25rem' }}>{service.name}</h3>
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '0.5rem' }}>{service.description}</p>
                                            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{service.duration} min</span>
                                                {service.location && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📍 {service.location}</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', flexShrink: 0 }}>
                                            <span style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)' }}>${service.price}</span>
                                            {user?.role === 'customer' && (
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
                    </div>

                    {/* Right — provider info card */}
                    <div style={{ position: 'sticky', top: '100px' }}>
                        <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem' }}>
                            <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>About</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                            </div>

                            {user?.role === 'customer' && (
                                <button
                                    onClick={() => navigate(`/book-appointment?providerId=${provider._id}`)}
                                    className="btn-primary"
                                    style={{ width: '100%', padding: '0.875rem', marginTop: '1.25rem', fontSize: '0.95rem' }}
                                >
                                    Book Now →
                                </button>
                            )}
                        </div>

                        {/* Recent reviews */}
                        {reviews.length > 0 && (
                            <div style={{ background: 'white', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                <h3 style={{ fontFamily: 'Playfair Display, serif', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Recent Reviews</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {reviews.map(review => (
                                        <div key={review._id} style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                                                <span style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--charcoal)' }}>{review.customer?.name}</span>
                                                <StarDisplay rating={review.rating} />
                                            </div>
                                            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{review.comment}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default ProviderProfilePage;