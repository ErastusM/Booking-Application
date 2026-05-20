import React, { useEffect, useState } from 'react';
import { serviceService, reviewService } from '../services';
import { useAuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const StarDisplay = ({ rating }) => (
    <div style={{ display: 'flex', gap: '2px' }}>
        {[1, 2, 3, 4, 5].map(star => (
            <span key={star} style={{
                color: star <= Math.round(rating) ? 'var(--gold)' : '#e2e0db',
                fontSize: '0.9rem',
            }}>★</span>
        ))}
    </div>
);

const ServiceCard = ({ service, user, navigate, index }) => {
    const [reviews, setReviews] = useState([]);
    const [avgRating, setAvgRating] = useState(null);
    const [reviewCount, setReviewCount] = useState(0);
    const [showReviews, setShowReviews] = useState(false);
    const [loadingReviews, setLoadingReviews] = useState(false);
    const [fetched, setFetched] = useState(false);

    useEffect(() => {
        // Pre-fetch review count for each card
        const fetchCount = async () => {
            try {
                const res = await reviewService.getServiceReviews(service._id);
                setReviewCount(res.data.count);
                setAvgRating(res.data.avgRating);
                setReviews(res.data.data);
                setFetched(true);
            } catch { }
        };
        fetchCount();
    }, [service._id]);

    const handleToggleReviews = () => {
        setShowReviews(!showReviews);
    };

    return (
        <div
            className="fade-up"
            style={{
                animationDelay: `${index * 0.08}s`,
                opacity: 0,
                background: 'white',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-sm)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
            }}
            onMouseEnter={e => {
                e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                e.currentTarget.style.transform = 'translateY(0)';
            }}
        >
            {/* Card header accent */}
            <div style={{
                height: '4px',
                background: 'linear-gradient(to right, var(--gold-dark), var(--gold-light))',
            }} />

            <div style={{ padding: '1.75rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Service name & duration */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <h3 style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '1.25rem',
                        fontWeight: '600',
                        color: 'var(--charcoal)',
                        lineHeight: 1.2,
                    }}>
                        {service.name}
                    </h3>
                    <span style={{
                        background: 'var(--warm-gray)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        padding: '0.25rem 0.6rem',
                        borderRadius: '99px',
                        whiteSpace: 'nowrap',
                        marginLeft: '0.75rem',
                    }}>
                        {service.duration} min
                    </span>
                </div>

                {/* Rating summary */}
                {reviewCount > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        <StarDisplay rating={parseFloat(avgRating)} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {avgRating} ({reviewCount} review{reviewCount !== 1 ? 's' : ''})
                        </span>
                    </div>
                )}

                <p style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.9rem',
                    lineHeight: '1.65',
                    marginBottom: '1.5rem',
                    flex: 1,
                }}>
                    {service.description}
                </p>

                {/* Price & Book */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 'auto',
                    paddingTop: '1.25rem',
                    borderTop: '1px solid var(--border)',
                }}>
                    <div>
                        <span style={{
                            fontFamily: 'Inter, sans-serif',
                            fontSize: '1.6rem',
                            fontWeight: '700',
                            color: 'var(--charcoal)',
                        }}>
                            ${service.price}
                        </span>
                    </div>
                    {user?.role === 'customer' && (
                        <button
                            onClick={() => navigate('/book-appointment')}
                            className="btn-primary"
                            style={{ padding: '0.6rem 1.25rem', fontSize: '0.85rem' }}
                        >
                            Book Now
                        </button>
                    )}
                    {!user && (
                        <button
                            onClick={() => navigate('/register')}
                            className="btn-outline"
                            style={{ padding: '0.6rem 1.25rem', fontSize: '0.85rem' }}
                        >
                            Sign Up to Book
                        </button>
                    )}
                </div>

                {/* Reviews toggle */}
                {fetched && (
                    <button
                        onClick={handleToggleReviews}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--gold-dark)',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            fontFamily: 'Inter, sans-serif',
                            padding: '0.75rem 0 0',
                            textAlign: 'left',
                            transition: 'color 0.2s',
                        }}
                    >
                        {showReviews
                            ? '▲ Hide reviews'
                            : reviewCount > 0
                                ? `▼ Read ${reviewCount} review${reviewCount !== 1 ? 's' : ''}`
                                : '▼ No reviews yet'}
                    </button>
                )}

                {/* Reviews list */}
                {showReviews && (
                    <div style={{
                        marginTop: '1rem',
                        borderTop: '1px solid var(--border)',
                        paddingTop: '1rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '1rem',
                        maxHeight: '220px',
                        overflowY: 'auto',
                    }}>
                        {reviews.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                Be the first to leave a review!
                            </p>
                        ) : (
                            reviews.map(review => (
                                <div key={review._id} style={{
                                    padding: '0.75rem',
                                    background: 'var(--warm-gray)',
                                    borderRadius: 'var(--radius-sm)',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                                        <span style={{ fontWeight: '600', fontSize: '0.85rem', color: 'var(--charcoal)' }}>
                                            {review.customer?.name}
                                        </span>
                                        <StarDisplay rating={review.rating} />
                                    </div>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                                        {review.comment}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const Services = () => {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { user } = useAuthContext();
    const navigate = useNavigate();

    useEffect(() => {
        const fetchServices = async () => {
            try {
                const response = await serviceService.getAllServices();
                setServices(response.data.data);
            } catch (err) {
                setError('Failed to fetch services');
            } finally {
                setLoading(false);
            }
        };
        fetchServices();
    }, []);

    if (loading) return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--off-white)',
        }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{
                    width: '40px',
                    height: '40px',
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--gold)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    margin: '0 auto 1rem',
                }} />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Loading services...</p>
            </div>
        </div>
    );

    return (
        <div style={{ background: 'var(--off-white)', minHeight: '100vh' }}>

            {/* Page header */}
            <div style={{
                background: 'var(--charcoal)',
                paddingTop: '9rem',
                paddingBottom: '4rem',
                position: 'relative',
                overflow: 'hidden',
            }}>
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: 'radial-gradient(ellipse at 80% 50%, rgba(201,168,76,0.08) 0%, transparent 60%)',
                    pointerEvents: 'none',
                }} />
                <div className="container" style={{ position: 'relative' }}>
                    <p style={{
                        color: 'var(--gold)',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        letterSpacing: '0.15em',
                        textTransform: 'uppercase',
                        marginBottom: '0.75rem',
                    }}>
                        What We Offer
                    </p>
                    <h1 style={{
                        fontFamily: 'Inter, sans-serif',
                        fontSize: 'clamp(2rem, 5vw, 3.5rem)',
                        fontWeight: '700',
                        color: 'white',
                        marginBottom: '1rem',
                    }}>
                        Our Services
                    </h1>
                    <p style={{
                        color: 'rgba(255,255,255,0.55)',
                        fontSize: '1rem',
                        maxWidth: '480px',
                        lineHeight: '1.7',
                        fontWeight: '300',
                    }}>
                        From classic cuts to full grooming packages — every service delivered with precision and care.
                    </p>
                </div>
            </div>

            {/* Services grid */}
            <div className="container" style={{ paddingTop: '3rem', paddingBottom: '5rem' }}>
                {error && (
                    <div style={{
                        background: '#fee2e2',
                        border: '1px solid #fca5a5',
                        color: '#991b1b',
                        padding: '0.75rem 1rem',
                        borderRadius: 'var(--radius-sm)',
                        marginBottom: '2rem',
                        fontSize: '0.9rem',
                    }}>
                        {error}
                    </div>
                )}

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                    gap: '1.5rem',
                }}>
                    {services.map((service, i) => (
                        <ServiceCard
                            key={service._id}
                            service={service}
                            user={user}
                            navigate={navigate}
                            index={i}
                        />
                    ))}
                </div>
            </div>

            {/* Spinner keyframe */}
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default Services;