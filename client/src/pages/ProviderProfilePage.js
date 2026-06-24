import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { providerMarketService, availabilityService, authService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { cloudinaryAvatar, cloudinaryThumb } from '../utils/cloudinary';
import { mapsUrl } from '../utils/maps';
import WalletTopUpModal from '../components/WalletTopUpModal';
import { Phone, MessageCircle, Mail, MapPin, ChevronLeft, ChevronRight, X } from 'lucide-react';

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map(s => (
            <span key={s} style={{ color: s <= Math.round(rating) ? 'var(--gold)' : '#e2e0db', fontSize: '0.9rem' }}>★</span>
        ))}
    </div>
);

const contactRowStyle = { display: 'flex', alignItems: 'center', gap: '0.6rem', textDecoration: 'none', color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: '500' };
const contactIconStyle = { width: '28px', height: '28px', borderRadius: '8px', background: 'var(--surface-sunken)', color: 'var(--gold-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 };
const lightboxBtnStyle = (pos) => ({ position: 'absolute', ...pos, top: pos.top || '50%', transform: pos.top ? 'none' : 'translateY(-50%)', width: '44px', height: '44px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(4px)' });

const ProviderProfilePage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, activeRole } = useAuthContext();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeCategory, setActiveCategory] = useState('featured');
    const [schedule, setSchedule] = useState(null);
    const [blocked, setBlocked] = useState(false);
    const [showTopUp, setShowTopUp] = useState(false);
    const [lightbox, setLightbox] = useState(-1); // index of the full-screen photo, -1 = closed

    useEffect(() => {
        if (!user) return;
        authService.getBlockedUsers()
            .then((r) => setBlocked((r.data.data || []).some((u) => u._id === id)))
            .catch(() => {});
    }, [id, user]);

    const toggleBlock = async () => {
        try {
            if (blocked) { await authService.unblockUser(id); setBlocked(false); }
            else if (window.confirm('Block this provider? You won’t be able to book or message each other.')) {
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
                navigate('/services');
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

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100dvh' }}>

            {/* Hero */}
            <div style={{ background: 'var(--ink)', paddingTop: '9rem', paddingBottom: '3rem', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 30% 60%, rgba(201,168,76,0.05) 0%, transparent 60%)', pointerEvents: 'none' }} />
                <div className="container" style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem' }}>
                        <button onClick={() => navigate('/services')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'var(--font-body)', padding: 0, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            ← Back to Services
                        </button>
                        {user && activeRole === 'customer' && (
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <button onClick={() => setShowTopUp(true)} style={{ background: 'rgba(201,168,76,0.15)', border: '1px solid var(--gold)', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: '600', fontFamily: 'var(--font-body)', padding: '0.35rem 0.95rem', borderRadius: '99px' }}>
                                    Top up wallet
                                </button>
                                <button onClick={toggleBlock} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'var(--font-body)', padding: '0.35rem 0.85rem', borderRadius: '99px' }}>
                                    {blocked ? 'Unblock provider' : 'Block provider'}
                                </button>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                        {provider.avatar ? (
                            <img src={cloudinaryAvatar(provider.avatar)} alt={provider.name} style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--gold)', flexShrink: 0 }} />
                        ) : (
                            <div style={{ width: '90px', height: '90px', borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: '2.2rem', fontWeight: '700', color: 'var(--ink)', flexShrink: 0 }}>
                                {getInitials(provider.name)}
                            </div>
                        )}
                        <div>
                            <h1 style={{ fontFamily: 'var(--font-body)', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: '700', color: 'white', marginBottom: '0.5rem' }}>
                                {businessName}
                            </h1>
                            {provider.providerCategory && (
                                <span style={{ display: 'inline-block', fontSize: '0.7rem', fontWeight: '600', padding: '0.2rem 0.7rem', borderRadius: '99px', background: 'rgba(201,168,76,0.15)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.4)', marginBottom: '0.6rem' }}>
                                    {provider.providerCategory}
                                </span>
                            )}
                            {address && (
                                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', margin: '0 0 0.6rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span aria-hidden="true">📍</span>{' '}
                                    <a href={mapsUrl(address)} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>{address}</a>
                                </p>
                            )}
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
                                {provider.likesCount > 0 && (
                                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                                        ❤️ {provider.likesCount} like{provider.likesCount !== 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Photo gallery — tap any photo for the full-screen viewer */}
            {photos.length > 0 && (
                <div className="container" style={{ paddingTop: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', scrollSnapType: 'x mandatory', paddingBottom: '0.35rem' }}>
                        {photos.map((src, i) => (
                            <button key={i} type="button" onClick={() => setLightbox(i)} aria-label={`View photo ${i + 1}`} style={{ flex: '0 0 auto', border: 'none', padding: 0, cursor: 'pointer', borderRadius: '14px', overflow: 'hidden', background: 'var(--warm-gray)', scrollSnapAlign: 'start', boxShadow: 'var(--shadow-sm)' }}>
                                <img src={cloudinaryThumb(src, 700)} alt={`${businessName} photo ${i + 1}`} loading="lazy" decoding="async" style={{ height: '230px', width: 'auto', maxWidth: '360px', objectFit: 'cover', display: 'block' }} />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="container" style={{ paddingTop: '2rem', paddingBottom: '5rem' }}>
                <div className="provider-profile-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '2rem', alignItems: 'start' }}>

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
                                        fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
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
                                                {service.location && <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📍 {service.location}</span>}
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.75rem', flexShrink: 0 }}>
                                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '1.2rem', fontWeight: '700', color: 'var(--charcoal)' }}>${service.price}</span>
                                            {activeRole !== 'provider' && (
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
                    <div className="provider-profile-sidebar" style={{ position: 'sticky', top: '100px' }}>
                        <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem', marginBottom: '1rem' }}>
                            <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>About</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {provider.providerCategory && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Category</span>
                                        <span style={{ fontSize: '0.8rem', fontWeight: '600', padding: '0.15rem 0.6rem', borderRadius: '99px', background: 'rgba(201,168,76,0.1)', color: 'var(--gold-dark)', border: '1px solid rgba(201,168,76,0.25)' }}>{provider.providerCategory}</span>
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

                            {activeRole !== 'provider' && (
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

                        {/* Recent reviews */}
                        {reviews.length > 0 && (
                            <div style={{ background: 'var(--card-bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', padding: '1.5rem' }}>
                                <h3 style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '600', color: 'var(--charcoal)', marginBottom: '1rem' }}>Recent Reviews</h3>
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